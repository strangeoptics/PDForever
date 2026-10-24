package com.pdforever.service;

import com.pdforever.domain.Document;
import com.pdforever.repository.DocumentRepository;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.*;

@Service
public class AsyncMetadataEnrichmentService {

    private static final Logger log = LoggerFactory.getLogger(AsyncMetadataEnrichmentService.class);
    private static final long RATE_LIMIT_DELAY_MS = 1000L;

    private final DocumentRepository documentRepository;
    private final MetadataEnrichmentService metadataEnrichmentService;
    private final StoragePathService storagePathService;

    private final BlockingQueue<UUID> queue = new LinkedBlockingQueue<>();
    private final Set<UUID> pendingDocIds = ConcurrentHashMap.newKeySet();
    private final ExecutorService virtualExecutor = Executors.newVirtualThreadPerTaskExecutor();
    private volatile boolean running = true;

    public AsyncMetadataEnrichmentService(
            DocumentRepository documentRepository,
            MetadataEnrichmentService metadataEnrichmentService,
            StoragePathService storagePathService
    ) {
        this.documentRepository = documentRepository;
        this.metadataEnrichmentService = metadataEnrichmentService;
        this.storagePathService = storagePathService;

        virtualExecutor.submit(this::processQueueLoop);
    }

    /**
     * Enqueues a document for asynchronous background external metadata lookup.
     */
    public boolean enqueue(UUID documentId) {
        if (documentId == null || !running) {
            return false;
        }
        if (pendingDocIds.add(documentId)) {
            queue.offer(documentId);
            log.debug("Enqueued document {} for background metadata enrichment (queue size={})", documentId, queue.size());
            return true;
        }
        return false;
    }

    public int getQueueSize() {
        return queue.size();
    }

    public boolean isPending(UUID documentId) {
        return documentId != null && pendingDocIds.contains(documentId);
    }

    private void processQueueLoop() {
        while (running && !Thread.currentThread().isInterrupted()) {
            try {
                UUID docId = queue.poll(200, TimeUnit.MILLISECONDS);
                if (docId == null) {
                    continue;
                }

                try {
                    processSingleDocument(docId);
                } finally {
                    pendingDocIds.remove(docId);
                }

                if (running && !queue.isEmpty()) {
                    Thread.sleep(RATE_LIMIT_DELAY_MS);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                log.warn("Error processing async metadata enrichment queue item: {}", e.getMessage(), e);
            }
        }
    }

    public void processSingleDocument(UUID docId) {
        Document doc = documentRepository.findById(docId).orElse(null);
        if (doc == null || doc.isDeleted()) {
            return;
        }

        if (doc.getDoi() == null && doc.getIsbn() == null) {
            return;
        }

        String source = doc.getMetadataSource();
        if ("MANUAL".equalsIgnoreCase(source) || "CROSSREF".equalsIgnoreCase(source)
                || "OPENLIBRARY".equalsIgnoreCase(source) || "SEMANTIC_SCHOLAR".equalsIgnoreCase(source)) {
            return;
        }

        try {
            Path fullPath = storagePathService.resolveDocumentPath(doc.getRelativePath());
            if (!Files.exists(fullPath)) {
                return;
            }

            boolean enriched = metadataEnrichmentService.enrichDocument(doc, fullPath, null, false, true);
            if (enriched) {
                Document current = documentRepository.findById(docId).orElse(null);
                if (current != null && !current.isDeleted()) {
                    current.setDoi(doc.getDoi());
                    current.setIsbn(doc.getIsbn());
                    current.setMetaTitle(doc.getMetaTitle());
                    current.setAuthors(doc.getAuthors());
                    current.setPublicationYear(doc.getPublicationYear());
                    current.setAbstractText(doc.getAbstractText());
                    current.setMetadataSource(doc.getMetadataSource());
                    current.setMetadataEnrichedAt(doc.getMetadataEnrichedAt());
                    documentRepository.save(current);
                    log.info("Successfully enriched metadata asynchronously for {}: title='{}', source={}",
                            current.getRelativePath(), current.getMetaTitle(), current.getMetadataSource());
                }
            }
        } catch (Exception e) {
            log.debug("Async enrichment failed for document {}: {}", docId, e.getMessage());
        }
    }

    @PreDestroy
    public void stop() {
        running = false;
        queue.clear();
        pendingDocIds.clear();
        virtualExecutor.shutdownNow();
        try {
            virtualExecutor.awaitTermination(1, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
}
