package com.pdforever;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.service.AsyncMetadataEnrichmentService;
import com.pdforever.service.FileNameCleaner;
import com.pdforever.service.MetadataEnrichmentService;
import com.pdforever.service.StoragePathService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class AsyncMetadataEnrichmentServiceTest {

    @TempDir
    Path tempDir;

    private AsyncMetadataEnrichmentService asyncService;
    private final AtomicReference<Document> docInDb = new AtomicReference<>();
    private final AtomicReference<Document> savedInDb = new AtomicReference<>();
    private final AtomicReference<java.util.concurrent.CountDownLatch> workerWaitLatch = new AtomicReference<>();

    @BeforeEach
    void setUp() {
        docInDb.set(null);
        savedInDb.set(null);
        workerWaitLatch.set(null);

        DocumentRepository fakeRepo = (DocumentRepository) Proxy.newProxyInstance(
                DocumentRepository.class.getClassLoader(),
                new Class<?>[]{DocumentRepository.class},
                (proxy, method, args) -> {
                    String name = method.getName();
                    if ("findById".equals(name)) {
                        java.util.concurrent.CountDownLatch latch = workerWaitLatch.get();
                        if (latch != null) {
                            latch.await();
                        }
                        return Optional.ofNullable(docInDb.get());
                    }
                    if ("save".equals(name)) {
                        Document saved = (Document) args[0];
                        savedInDb.set(saved);
                        return saved;
                    }
                    return null;
                }
        );

        LibraryProperties properties = new LibraryProperties(
                tempDir.resolve("storage"),
                tempDir.resolve("lucene"),
                tempDir.resolve("covers"),
                500L,
                false,
                List.of(),
                List.of(),
                new LibraryProperties.RagProperties(false, "http://localhost:11434", "qwen2.5:14b", 8)
        );
        StoragePathService storagePathService = new StoragePathService(properties);
        FileNameCleaner fileNameCleaner = new FileNameCleaner(properties);
        MetadataEnrichmentService metadataEnrichmentService = new MetadataEnrichmentService(new ObjectMapper(), fileNameCleaner);

        asyncService = new AsyncMetadataEnrichmentService(fakeRepo, metadataEnrichmentService, storagePathService);
    }

    @AfterEach
    void tearDown() {
        if (asyncService != null) {
            asyncService.stop();
        }
    }

    @Test
    void testEnqueueDeduplication() {
        UUID id = UUID.randomUUID();
        java.util.concurrent.CountDownLatch holdWorker = new java.util.concurrent.CountDownLatch(1);
        workerWaitLatch.set(holdWorker);

        try {
            boolean first = asyncService.enqueue(id);
            assertThat(first).isTrue();

            boolean second = asyncService.enqueue(id);
            assertThat(second).isFalse();
            assertThat(asyncService.isPending(id)).isTrue();
        } finally {
            holdWorker.countDown();
        }
    }

    @Test
    void testProcessSingleDocument_SkipsIfNoDoiOrIsbn() {
        UUID docId = UUID.randomUUID();
        Document doc = new Document();
        doc.setId(docId);
        doc.setRelativePath("test.pdf");
        doc.setFileName("test.pdf");
        doc.setFileSizeBytes(100L);
        doc.setPageCount(1);
        doc.setLastModifiedFs(Instant.now());
        docInDb.set(doc);

        asyncService.processSingleDocument(docId);

        assertThat(savedInDb.get()).isNull();
    }

    @Test
    void testProcessSingleDocument_SkipsIfAlreadyApiEnriched() {
        UUID docId = UUID.randomUUID();
        Document doc = new Document();
        doc.setId(docId);
        doc.setRelativePath("test.pdf");
        doc.setFileName("test.pdf");
        doc.setDoi("10.1000/182");
        doc.setMetadataSource("CROSSREF");
        docInDb.set(doc);

        asyncService.processSingleDocument(docId);

        assertThat(savedInDb.get()).isNull();
    }

    @Test
    void testProcessSingleDocument_WithDoiAndLocalMeta() throws Exception {
        Path pdfFile = tempDir.resolve("storage").resolve("test.pdf");
        Files.createDirectories(pdfFile.getParent());
        Files.createFile(pdfFile);

        UUID docId = UUID.randomUUID();
        Document doc = new Document();
        doc.setId(docId);
        doc.setRelativePath("test.pdf");
        doc.setFileName("test.pdf");
        doc.setDoi("10.1000/182");
        doc.setMetadataSource("PATH_HEURISTIC");
        docInDb.set(doc);

        // processSingleDocument executes synchronously
        asyncService.processSingleDocument(docId);

        // External lookup is disabled in properties, so it finishes gracefully without errors
        assertThat(asyncService.getQueueSize()).isEqualTo(0);
    }
}
