package com.pdforever;

import com.pdforever.domain.Document;
import com.pdforever.dto.*;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.service.LibraryManagementService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.CleanupMode;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Page;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class DatabasePaginationAndFilteringTest {

    @TempDir(cleanup = CleanupMode.NEVER)
    static Path tempDir;

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        Path rootDir = tempDir.resolve("storage");
        Path luceneDir = tempDir.resolve("lucene");
        Path coversDir = tempDir.resolve("covers");
        Path dbFile = tempDir.resolve("test-db-filter.db");

        registry.add("library.root-dir", rootDir::toString);
        registry.add("library.lucene-dir", luceneDir::toString);
        registry.add("library.covers-dir", coversDir::toString);
        registry.add("library.watcher-enabled", () -> "false");
        registry.add("library.metadata-lookup-enabled", () -> "false");
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + dbFile.toAbsolutePath() + "?journal_mode=WAL&foreign_keys=on");
    }

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private LibraryManagementService libraryService;

    @Autowired
    private com.pdforever.service.DirectoryScannerService scannerService;

    @Test
    void testDbDrivenPaginationSortingAndFacets() {
        // 1. Create tags
        TagDto tagJava = libraryService.createTag(new CreateTagRequest("Java", "#ff0000"));
        TagDto tagSpring = libraryService.createTag(new CreateTagRequest("Spring", "#00ff00"));
        TagDto tagArchitecture = libraryService.createTag(new CreateTagRequest("Architecture", "#0000ff"));

        // 2. Insert 6 test documents
        Document doc1 = createDoc("Backend/java_concurrency.pdf", "Java Concurrency in Practice", 350, 2006, "READING");
        Document doc2 = createDoc("Backend/spring_boot_ref.pdf", "Spring Boot Reference", 500, 2023, "COMPLETED");
        Document doc3 = createDoc("Backend/clean_architecture.pdf", "Clean Architecture", 300, 2017, "UNREAD");
        Document doc4 = createDoc("Frontend/react_handbook.pdf", "React Handbook", 120, 2022, "UNREAD");
        Document doc5 = createDoc("Frontend/typescript_deep_dive.pdf", "TypeScript Deep Dive", 180, 2021, "COMPLETED");
        Document doc6 = createDoc("Short/intro.pdf", "Introduction to Systems", 15, 2020, "UNREAD");

        // Set metadata on doc1
        doc1.setMetaTitle("Java Concurrency Masterclass");
        doc1.setDoi("10.1000/182");
        doc1.setLastOpenedAt(Instant.now());
        documentRepository.save(doc1);

        // Assign tags
        libraryService.addTagToDocument(doc1.getId(), tagJava.id());
        libraryService.addTagToDocument(doc1.getId(), tagSpring.id());

        libraryService.addTagToDocument(doc2.getId(), tagJava.id());
        libraryService.addTagToDocument(doc2.getId(), tagSpring.id());
        libraryService.addTagToDocument(doc2.getId(), tagArchitecture.id());

        libraryService.addTagToDocument(doc3.getId(), tagArchitecture.id());

        // Add reading notes
        libraryService.createNote(new CreateNoteRequest(doc1.getId(), 10, "thread safety", "Critical notes on Java memory model", null));
        libraryService.createNote(new CreateNoteRequest(doc1.getId(), 25, "locks", "ReentrantLock vs synchronized", null));
        libraryService.createNote(new CreateNoteRequest(doc2.getId(), 50, "auto-configuration", "Notes on Spring Boot conditional beans", null));

        // 3. Verify Pagination
        Page<DocumentDto> page0 = libraryService.getDocuments(DocumentFilterCriteria.empty(), 0, 2);
        assertThat(page0.getTotalElements()).isEqualTo(6);
        assertThat(page0.getTotalPages()).isEqualTo(3);
        assertThat(page0.getContent()).hasSize(2);

        Page<DocumentDto> page1 = libraryService.getDocuments(DocumentFilterCriteria.empty(), 1, 2);
        assertThat(page1.getContent()).hasSize(2);
        // Ensure no overlapping elements between page 0 and page 1
        Set<UUID> page0Ids = Set.of(page0.getContent().get(0).id(), page0.getContent().get(1).id());
        assertThat(page0Ids).doesNotContain(page1.getContent().get(0).id());

        // 4. Test Sorting by noteCount descending
        DocumentFilterCriteria sortByNotes = new DocumentFilterCriteria(
                null, null, null, null, null, null, null, null, null, null, null, null, "noteCount", "desc"
        );
        Page<DocumentDto> sortedByNotes = libraryService.getDocuments(sortByNotes, 0, 6);
        // doc1 has 2 notes, doc2 has 1 note, others have 0 notes
        assertThat(sortedByNotes.getContent().get(0).id()).isEqualTo(doc1.getId());
        assertThat(sortedByNotes.getContent().get(0).noteCount()).isEqualTo(2);
        assertThat(sortedByNotes.getContent().get(1).id()).isEqualTo(doc2.getId());
        assertThat(sortedByNotes.getContent().get(1).noteCount()).isEqualTo(1);

        // 5. Test Sorting by pageCount ascending
        DocumentFilterCriteria sortByPagesAsc = new DocumentFilterCriteria(
                null, null, null, null, null, null, null, null, null, null, null, null, "pageCount", "asc"
        );
        Page<DocumentDto> sortedByPages = libraryService.getDocuments(sortByPagesAsc, 0, 6);
        assertThat(sortedByPages.getContent().get(0).id()).isEqualTo(doc6.getId()); // 15 pages
        assertThat(sortedByPages.getContent().get(0).pageCount()).isEqualTo(15);

        // 6. Test Multi-Tag Filtering (must have both Java AND Spring)
        DocumentFilterCriteria javaAndSpring = new DocumentFilterCriteria(
                null, "Java,Spring", null, null, null, null, null, null, null, null, null, null, "fileName", "asc"
        );
        Page<DocumentDto> tagFiltered = libraryService.getDocuments(javaAndSpring, 0, 10);
        assertThat(tagFiltered.getContent()).extracting(DocumentDto::id).containsExactlyInAnyOrder(doc1.getId(), doc2.getId());

        // Must have Architecture AND Spring
        DocumentFilterCriteria archAndSpring = new DocumentFilterCriteria(
                null, "Architecture,Spring", null, null, null, null, null, null, null, null, null, null, "fileName", "asc"
        );
        Page<DocumentDto> archFiltered = libraryService.getDocuments(archAndSpring, 0, 10);
        assertThat(archFiltered.getContent()).extracting(DocumentDto::id).containsExactly(doc2.getId());

        // 7. Test hasNotes = true and noteQuery
        DocumentFilterCriteria hasNotesCriteria = new DocumentFilterCriteria(
                null, null, null, null, null, true, null, null, null, null, null, null, "fileName", "asc"
        );
        Page<DocumentDto> notesOnly = libraryService.getDocuments(hasNotesCriteria, 0, 10);
        assertThat(notesOnly.getContent()).extracting(DocumentDto::id).containsExactlyInAnyOrder(doc1.getId(), doc2.getId());

        DocumentFilterCriteria memoryModelQuery = new DocumentFilterCriteria(
                null, null, null, null, null, true, "memory model", null, null, null, null, null, "fileName", "asc"
        );
        Page<DocumentDto> queryNotes = libraryService.getDocuments(memoryModelQuery, 0, 10);
        assertThat(queryNotes.getContent()).extracting(DocumentDto::id).containsExactly(doc1.getId());

        // 8. Test Path Prefix Filter
        DocumentFilterCriteria backendOnly = new DocumentFilterCriteria(
                "Backend", null, null, null, null, null, null, null, null, null, null, null, "fileName", "asc"
        );
        Page<DocumentDto> backendDocs = libraryService.getDocuments(backendOnly, 0, 10);
        assertThat(backendDocs.getContent()).extracting(DocumentDto::id).containsExactlyInAnyOrder(doc1.getId(), doc2.getId(), doc3.getId());

        // 9. Test findMatchingDocumentIds (lightweight ID query for SearchService / RAG)
        Set<UUID> matchingIds = libraryService.findMatchingDocumentIds(backendOnly);
        assertThat(matchingIds).containsExactlyInAnyOrder(doc1.getId(), doc2.getId(), doc3.getId());

        // 10. Test getDocumentFacets computed directly in database
        DocumentFacetsDto allFacets = libraryService.getDocumentFacets(null);
        assertThat(allFacets.totalDocuments()).isEqualTo(6);
        assertThat(allFacets.unreadCount()).isEqualTo(3);     // doc3, doc4, doc6
        assertThat(allFacets.readingCount()).isEqualTo(1);    // doc1
        assertThat(allFacets.completedCount()).isEqualTo(2);  // doc2, doc5
        assertThat(allFacets.withNotesCount()).isEqualTo(2);  // doc1, doc2
        assertThat(allFacets.totalNotesCount()).isEqualTo(3); // 2 in doc1 + 1 in doc2
        assertThat(allFacets.withMetadataCount()).isEqualTo(1); // doc1 has DOI & metaTitle
        assertThat(allFacets.shortDocsCount()).isEqualTo(1);  // doc6 has 15 pages
        assertThat(allFacets.minPageCount()).isEqualTo(15);
        assertThat(allFacets.maxPageCount()).isEqualTo(500);
        assertThat(allFacets.minPublicationYear()).isEqualTo(2006);
        assertThat(allFacets.maxPublicationYear()).isEqualTo(2023);

        // Path-scoped facets for "Frontend"
        DocumentFacetsDto frontendFacets = libraryService.getDocumentFacets("Frontend");
        assertThat(frontendFacets.totalDocuments()).isEqualTo(2);
        assertThat(frontendFacets.unreadCount()).isEqualTo(1);
        assertThat(frontendFacets.completedCount()).isEqualTo(1);
        assertThat(frontendFacets.minPublicationYear()).isEqualTo(2021);
        assertThat(frontendFacets.maxPublicationYear()).isEqualTo(2022);

        // 11. Test in-memory buildDirectoryTree() without disk I/O
        TreeNodeDto tree = scannerService.buildDirectoryTree();
        assertThat(tree.name()).isEqualTo("Library");
        assertThat(tree.type()).isEqualTo("directory");
        assertThat(tree.path()).isEqualTo("");
        // Root has 3 directory children: Backend, Frontend, Short
        assertThat(tree.children()).extracting(TreeNodeDto::name).containsExactly("Backend", "Frontend", "Short");

        TreeNodeDto backendNode = tree.children().get(0);
        assertThat(backendNode.name()).isEqualTo("Backend");
        assertThat(backendNode.path()).isEqualTo("Backend");
        assertThat(backendNode.type()).isEqualTo("directory");
        assertThat(backendNode.children()).hasSize(3);
        assertThat(backendNode.children()).extracting(TreeNodeDto::name)
                .containsExactly("Clean Architecture", "Java Concurrency in Practice", "Spring Boot Reference");
        assertThat(backendNode.children().get(1).type()).isEqualTo("file");
        assertThat(backendNode.children().get(1).documentId()).isEqualTo(doc1.getId());
        assertThat(backendNode.children().get(1).pageCount()).isEqualTo(350);
    }

    private Document createDoc(String relPath, String fileName, int pages, int year, String status) {
        Document doc = new Document();
        doc.setRelativePath(relPath);
        doc.setFileName(fileName);
        doc.setFileSizeBytes(1024L * 1024L);
        doc.setPageCount(pages);
        doc.setPublicationYear(year);
        doc.setReadingStatus(status);
        doc.setLastModifiedFs(Instant.now());
        doc.setCreatedAt(Instant.now());
        doc.setDeleted(false);
        return documentRepository.save(doc);
    }
}

