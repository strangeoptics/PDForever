package com.pdforever;

import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import com.pdforever.dto.*;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.service.DirectoryScannerService;
import com.pdforever.service.FileWatcherService;
import com.pdforever.service.LibraryManagementService;
import com.pdforever.service.SearchService;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
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
class IngestionAndSearchIntegrationTest {

    @TempDir
    static Path tempDir;

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        Path rootDir = tempDir.resolve("storage");
        Path luceneDir = tempDir.resolve("lucene");
        Path dbFile = tempDir.resolve("test-pdforever.db");

        registry.add("library.root-dir", rootDir::toString);
        registry.add("library.lucene-dir", luceneDir::toString);
        registry.add("library.watcher-enabled", () -> "false");
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
    private LibraryProperties libraryProperties;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void fullIngestionReconciliationSearchRangeStreamingAndNotesPipeline() throws Exception {
        Path rootDir = libraryProperties.rootDir();
        Path scienceDir = rootDir.resolve("Science/Physics");
        Files.createDirectories(scienceDir);

        // 1. Create a valid 2-page PDF in Science/Physics/quantum_computing.pdf
        Path pdfFile = scienceDir.resolve("quantum_computing.pdf");
        createSamplePdf(pdfFile, List.of(
                "Page one introduces quantum superposition and entanglement in superconducting qubits.",
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

        // 9. Verify FileNameCleaner rules
        assertThat(fileNameCleaner.cleanFileName("Essen_und_Trinken_Fur_jeden_Tag_1.23_de.downmagaz.net.pdf"))
                .isEqualTo("Essen_und_Trinken_Fur_jeden_Tag_1.23.pdf");
        assertThat(fileNameCleaner.cleanFileName(
                "Ethnologie - Biographie einer Kulturwissenschaft -- Roman Loimeier; Dietrich-Reimer-Verlag -- 1_ Auflage, Berlin, 2021 -- Dietrich Reimer Verlag GmbH -- 9783496016663  -- Anna's A.pdf"
        )).isEqualTo("Ethnologie - Biographie einer Kulturwissenschaft -- Roman Loimeier; Dietrich-Reimer-Verlag -- 1_ Auflage, Berlin, 2021.pdf");
    }

    private void createSamplePdf(Path target, List<String> pageContents) throws IOException {
        try (PDDocument doc = new PDDocument()) {
            PDType1Font font = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
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
            }
            doc.save(target.toFile());
        }
    }
}

