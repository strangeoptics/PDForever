package com.pdforever;

import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import com.pdforever.dto.*;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.service.DirectoryScannerService;
import com.pdforever.service.FileWatcherService;
import com.pdforever.service.LibraryManagementService;
import com.pdforever.service.MetadataEnrichmentService;
import com.pdforever.service.SearchService;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.destination.PDPageFitWidthDestination;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDDocumentOutline;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IngestionAndSearchIntegrationTest {

    @TempDir(cleanup = org.junit.jupiter.api.io.CleanupMode.NEVER)
    static Path tempDir;

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        Path rootDir = tempDir.resolve("storage");
        Path luceneDir = tempDir.resolve("lucene");
        Path coversDir = tempDir.resolve("covers");
        Path dbFile = tempDir.resolve("test-pdforever.db");

        registry.add("library.root-dir", rootDir::toString);
        registry.add("library.lucene-dir", luceneDir::toString);
        registry.add("library.covers-dir", coversDir::toString);
        registry.add("library.watcher-enabled", () -> "false");
        registry.add("library.metadata-lookup-enabled", () -> "false");
        registry.add("library.debounce-ms", () -> "100");
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + dbFile.toAbsolutePath() + "?journal_mode=WAL&foreign_keys=on");
    }

    @Autowired
    private DirectoryScannerService scannerService;

    @Autowired
    private SearchService searchService;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private LibraryManagementService libraryService;

    @Autowired
    private FileWatcherService fileWatcherService;

    @Autowired
    private com.pdforever.service.FileNameCleaner fileNameCleaner;

    @Autowired
    private MetadataEnrichmentService metadataEnrichmentService;

    @Autowired
    private LibraryProperties libraryProperties;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void fullIngestionReconciliationSearchRangeStreamingAndNotesPipeline() throws Exception {
        Path rootDir = libraryProperties.rootDir();
        Path scienceDir = rootDir.resolve("Science/Physics");
        Files.createDirectories(scienceDir);

        // 1. Create a valid 2-page PDF in Science/Physics/quantum_computing.pdf with DOI and ISBN on page 1
        Path pdfFile = scienceDir.resolve("quantum_computing.pdf");
        createSamplePdf(pdfFile, List.of(
                "Page one introduces quantum superposition and entanglement in superconducting qubits. DOI: 10.1038/s41586-019-1666-5 ISBN 978-3-496-01666-3",
                "Page two discusses Shor algorithm and fault-tolerant topological quantum error correction."
        ));

        // Also create a corrupt PDF file to verify resilience
        Path corruptFile = scienceDir.resolve("corrupt_paper.pdf");
        Files.writeString(corruptFile, "NOT A VALID PDF HEADER");

        // 2. Run startup reconciliation
        var report1 = scannerService.reconcileLibrary();
        assertThat(report1.added()).isEqualTo(1);
        assertThat(report1.updated()).isEqualTo(0);
        assertThat(report1.deleted()).isEqualTo(0);

        // Verify relative path uses portable '/' separator and metadata is stored
        Document savedDoc = documentRepository.findByRelativePath("Science/Physics/quantum_computing.pdf").orElseThrow();
        assertThat(savedDoc.getPageCount()).isEqualTo(2);
        assertThat(savedDoc.isDeleted()).isFalse();
        assertThat(savedDoc.getDoi()).isEqualTo("10.1038/s41586-019-1666-5");
        assertThat(savedDoc.getIsbn()).isEqualTo("9783496016663");

        // 2b. Verify manual metadata update and API response parsers
        DocumentDto updatedMeta = libraryService.updateDocumentMetadata(
                savedDoc.getId(),
                new UpdateMetadataRequest(
                        "10.1038/s41586-019-1666-5",
                        "9783496016663",
                        "Quantum Supremacy Using a Programmable Superconducting Processor",
                        "Frank Arute, Kunal Arya, Ryan Babbush",
                        2019,
                        "The promise of quantum computers is that certain computational tasks might be executed exponentially faster."
                )
        );
        assertThat(updatedMeta.metaTitle()).isEqualTo("Quantum Supremacy Using a Programmable Superconducting Processor");
        assertThat(updatedMeta.authors()).isEqualTo("Frank Arute, Kunal Arya, Ryan Babbush");
        assertThat(updatedMeta.publicationYear()).isEqualTo(2019);
        assertThat(updatedMeta.metadataSource()).isEqualTo("MANUAL");

        var crossRefParsed = metadataEnrichmentService.parseCrossRefJson("10.1038/test", """
                {
                  "message": {
                    "title": ["Attention Is All You Need"],
                    "author": [{"given": "Ashish", "family": "Vaswani"}, {"given": "Noam", "family": "Shazeer"}],
                    "issued": {"date-parts": [[2017, 6, 12]]},
                    "abstract": "<jats:p>The dominant sequence transduction models are based on complex recurrent neural networks.</jats:p>"
                  }
                }
                """).orElseThrow();
        assertThat(crossRefParsed.title()).isEqualTo("Attention Is All You Need");
        assertThat(crossRefParsed.authors()).isEqualTo("Ashish Vaswani, Noam Shazeer");
        assertThat(crossRefParsed.publicationYear()).isEqualTo(2017);
        assertThat(crossRefParsed.abstractText()).isEqualTo("The dominant sequence transduction models are based on complex recurrent neural networks.");

        var openLibParsed = metadataEnrichmentService.parseOpenLibraryJson("9783496016663", """
                {
                  "ISBN:9783496016663": {
                    "title": "Ethnologie",
                    "subtitle": "Biographie einer Kulturwissenschaft",
                    "authors": [{"name": "Roman Loimeier"}],
                    "publish_date": "Berlin, 2021",
                    "notes": "Comprehensive history of cultural anthropology."
                  }
                }
                """).orElseThrow();
        assertThat(openLibParsed.title()).isEqualTo("Ethnologie — Biographie einer Kulturwissenschaft");
        assertThat(openLibParsed.authors()).isEqualTo("Roman Loimeier");
        assertThat(openLibParsed.publicationYear()).isEqualTo(2021);

        // 3. Search page-indexed Lucene documents with UnifiedHighlighter snippet highlighting
        List<SearchResultGroupDto> results = searchService.search("superconducting");
        assertThat(results).hasSize(1);
        assertThat(results.getFirst().docId()).isEqualTo(savedDoc.getId());
        assertThat(results.getFirst().matches()).hasSize(1);
        assertThat(results.getFirst().matches().getFirst().pageNumber()).isEqualTo(1);
        assertThat(results.getFirst().matches().getFirst().snippetHtml()).contains("<mark>superconducting</mark>");

        List<SearchResultGroupDto> page2Results = searchService.search("topological");
        assertThat(page2Results).hasSize(1);
        assertThat(page2Results.getFirst().matches().getFirst().pageNumber()).isEqualTo(2);
        assertThat(page2Results.getFirst().matches().getFirst().snippetHtml()).contains("<mark>topological</mark>");

        // 4. Test HTTP Byte-Range Streaming (206 Partial Content via ResourceRegion)
        mockMvc.perform(get("/api/documents/{id}/stream", savedDoc.getId())
                        .header(HttpHeaders.RANGE, "bytes=0-127"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string(HttpHeaders.ACCEPT_RANGES, "bytes"))
                .andExpect(header().exists(HttpHeaders.CONTENT_RANGE))
                .andExpect(header().longValue(HttpHeaders.CONTENT_LENGTH, 128L));

        // 4b. Test PDF Cover Thumbnail Generation & Caching
        mockMvc.perform(get("/api/documents/{id}/cover", savedDoc.getId()))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/jpeg"));

        // 4c. Test PDF Bookmarks / Table of Contents (TOC) Extraction
        List<TocItemDto> outline = libraryService.getDocumentOutline(savedDoc.getId());
        assertThat(outline).hasSize(2);
        assertThat(outline.get(0).title()).isEqualTo("Chapter 1");
        assertThat(outline.get(0).pageNumber()).isEqualTo(1);
        assertThat(outline.get(1).title()).isEqualTo("Chapter 2");
        assertThat(outline.get(1).pageNumber()).isEqualTo(2);

        // 4d. Test Reading Progress & Status Tracking
        DocumentDto updatedProgress = libraryService.updateReadingProgress(
                savedDoc.getId(),
                new UpdateReadingProgressRequest(2, null)
        );
        assertThat(updatedProgress.lastReadPage()).isEqualTo(2);
        assertThat(updatedProgress.readingStatus()).isEqualTo("READING");
        assertThat(updatedProgress.lastOpenedAt()).isNotNull();

        List<DocumentDto> recentDocs = libraryService.getRecentDocuments(5);
        assertThat(recentDocs).extracting(DocumentDto::id).contains(savedDoc.getId());

        DocumentDto completedProgress = libraryService.updateReadingProgress(
                savedDoc.getId(),
                new UpdateReadingProgressRequest(2, "COMPLETED")
        );
        assertThat(completedProgress.readingStatus()).isEqualTo("COMPLETED");
        assertThat(libraryService.getDocuments(null, null, "COMPLETED", 0, 10).getTotalElements()).isEqualTo(1);

        // 5. Test Tags & ReadingNotes (Lesezettel) with normalized bounding boxes
        TagDto tag = libraryService.createTag(new CreateTagRequest("Quantum", "#8b5cf6"));
        DocumentDto docWithTag = libraryService.addTagToDocument(savedDoc.getId(), tag.id());
        assertThat(docWithTag.tags()).extracting(TagDto::name).containsExactly("Quantum");

        ReadingNoteDto note = libraryService.createNote(new CreateNoteRequest(
                savedDoc.getId(),
                2,
                "fault-tolerant topological quantum error correction",
                "Crucial insight on **surface codes** and non-Abelian anyons.",
                new BoundingBoxDto(0.12, 0.34, 0.88, 0.42)
        ));
        assertThat(note.id()).isNotNull();
        assertThat(note.boundingBox().x1()).isEqualTo(0.12);

        List<ReadingNoteDto> foundNotes = libraryService.searchNotes("anyons");
        assertThat(foundNotes).hasSize(1);
        assertThat(foundNotes.getFirst().id()).isEqualTo(note.id());

        // 5b. Test Faceted Discovery Filters (tags, page count range, hasNotes, noteQuery, modifiedAfter, publicationYear)
        DocumentFacetsDto facets = libraryService.getDocumentFacets(null);
        assertThat(facets.totalDocuments()).isEqualTo(1);
        assertThat(facets.completedCount()).isEqualTo(1);
        assertThat(facets.withNotesCount()).isEqualTo(1);
        assertThat(facets.totalNotesCount()).isEqualTo(1);
        assertThat(facets.withMetadataCount()).isEqualTo(1);
        assertThat(facets.shortDocsCount()).isEqualTo(1);

        DocumentFilterCriteria matchingCriteria = new DocumentFilterCriteria(
                "Science",
                "Quantum",
                "COMPLETED",
                1,
                10,
                true,
                "anyons",
                Instant.now().minusSeconds(3600),
                Instant.now().plusSeconds(3600),
                2015,
                2025,
                true,
                "pageCount",
                "desc"
        );
        assertThat(libraryService.getDocuments(matchingCriteria, 0, 10).getTotalElements()).isEqualTo(1);
        assertThat(searchService.search("superconducting", matchingCriteria)).hasSize(1);

        DocumentFilterCriteria nonMatchingNoteTopic = new DocumentFilterCriteria(
                null, null, null, null, null, true, "nonexistent-topic-xyz", null, null, null, null, null, "fileName", "asc"
        );
        assertThat(libraryService.getDocuments(nonMatchingNoteTopic, 0, 10).getTotalElements()).isEqualTo(0);
        assertThat(searchService.search("superconducting", nonMatchingNoteTopic)).isEmpty();

        // 6. Modify the PDF on disk and verify re-indexing
        createSamplePdf(pdfFile, List.of(
                "Updated first page Content.",
                "Updated second page Content.",
                "Third page newly added with Hamiltonian simulation."
        ));
        Files.setLastModifiedTime(pdfFile, FileTime.from(Instant.now().plusSeconds(10)));

        var report2 = scannerService.reconcileLibrary();
        assertThat(report2.updated()).isEqualTo(1);

        Document updatedDoc = documentRepository.findById(savedDoc.getId()).orElseThrow();
        assertThat(updatedDoc.getPageCount()).isEqualTo(3);

        List<SearchResultGroupDto> page3Search = searchService.search("Hamiltonian");
        assertThat(page3Search).hasSize(1);
        assertThat(page3Search.getFirst().matches().getFirst().pageNumber()).isEqualTo(3);

        // 7. Delete file from disk and verify is_deleted=true in DB & purged from Lucene
        Files.delete(pdfFile);
        var report3 = scannerService.reconcileLibrary();
        assertThat(report3.deleted()).isEqualTo(1);

        Document deletedDoc = documentRepository.findById(savedDoc.getId()).orElseThrow();
        assertThat(deletedDoc.isDeleted()).isTrue();
        assertThat(searchService.search("Hamiltonian")).isEmpty();

        // 8. Verify WatchService debouncing stability check
        Path debouncedFile = scienceDir.resolve("debounced.pdf");
        createSamplePdf(debouncedFile, List.of("Stable file content."));
        boolean stable = fileWatcherService.waitForFileSizeStability(debouncedFile, 50L, 4);
        assertThat(stable).isTrue();

        // 9. Verify FileNameCleaner rules and publication year extraction from filename (1.23 -> 2023) and directory (/2023 -> 2023)
        assertThat(fileNameCleaner.cleanFileName("Essen_und_Trinken_Fur_jeden_Tag_1.23_de.downmagaz.net.pdf"))
                .isEqualTo("Essen_und_Trinken_Fur_jeden_Tag_1.23.pdf");
        assertThat(fileNameCleaner.cleanFileName(
                "Ethnologie - Biographie einer Kulturwissenschaft -- Roman Loimeier; Dietrich-Reimer-Verlag -- 1_ Auflage, Berlin, 2021 -- Dietrich Reimer Verlag GmbH -- 9783496016663  -- Anna's A.pdf"
        )).isEqualTo("Ethnologie - Biographie einer Kulturwissenschaft -- Roman Loimeier; Dietrich-Reimer-Verlag -- 1_ Auflage, Berlin, 2021.pdf");

        assertThat(metadataEnrichmentService.extractYearFromPathOrFileName(
                "Magazines/Essen_und_Trinken_Fur_jeden_Tag_1.23_de.downmagaz.net.pdf",
                "Essen_und_Trinken_Fur_jeden_Tag_1.23.pdf"
        )).contains(2023);

        assertThat(metadataEnrichmentService.extractYearFromPathOrFileName(
                "2023/Rezepte_Ausgabe.pdf",
                "Rezepte_Ausgabe.pdf"
        )).contains(2023);

        assertThat(metadataEnrichmentService.extractYearFromPathOrFileName(
                "Archiv/2024/Heft_Sonderausgabe.pdf",
                "Heft_Sonderausgabe.pdf"
        )).contains(2024);
    }

    private void createSamplePdf(Path target, List<String> pageContents) throws IOException {
        try (PDDocument doc = new PDDocument()) {
            PDType1Font font = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
            PDDocumentOutline outline = new PDDocumentOutline();
            doc.getDocumentCatalog().setDocumentOutline(outline);

            int idx = 1;
            for (String text : pageContents) {
                PDPage page = new PDPage();
                doc.addPage(page);
                try (PDPageContentStream contentStream = new PDPageContentStream(doc, page)) {
                    contentStream.beginText();
                    contentStream.setFont(font, 12);
                    contentStream.newLineAtOffset(50, 700);
                    contentStream.showText(text);
                    contentStream.endText();
                }

                PDPageFitWidthDestination dest = new PDPageFitWidthDestination();
                dest.setPage(page);
                PDOutlineItem bookmark = new PDOutlineItem();
                bookmark.setDestination(dest);
                bookmark.setTitle("Chapter " + idx++);
                outline.addLast(bookmark);
            }
            doc.save(target.toFile());
        }
    }
}

