package com.pdforever.service;

import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import com.pdforever.dto.TreeNodeDto;
import com.pdforever.repository.DocumentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Stream;

@Service
public class DirectoryScannerService {

    private static final Logger log = LoggerFactory.getLogger(DirectoryScannerService.class);
    private static final int BATCH_COMMIT_INTERVAL = 50;

    private final LibraryProperties properties;
    private final StoragePathService storagePathService;
    private final CoverThumbnailService coverThumbnailService;
    private final DocumentRepository documentRepository;
    private final PdfExtractionService pdfExtractionService;
    private final LuceneIndexService luceneIndexService;
    private final FileNameCleaner fileNameCleaner;
    private final MetadataEnrichmentService metadataEnrichmentService;

    public DirectoryScannerService(
            LibraryProperties properties,
            StoragePathService storagePathService,
            CoverThumbnailService coverThumbnailService,
            DocumentRepository documentRepository,
            PdfExtractionService pdfExtractionService,
            LuceneIndexService luceneIndexService,
            FileNameCleaner fileNameCleaner,
            MetadataEnrichmentService metadataEnrichmentService
    ) {
        this.properties = properties;
        this.storagePathService = storagePathService;
        this.coverThumbnailService = coverThumbnailService;
        this.documentRepository = documentRepository;
        this.pdfExtractionService = pdfExtractionService;
        this.luceneIndexService = luceneIndexService;
        this.fileNameCleaner = fileNameCleaner;
        this.metadataEnrichmentService = metadataEnrichmentService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        reconcileLibrary();
    }

    public Path getRootPath() {
        return storagePathService.getRootPath();
    }

    public Path getCoversPath() {
        return storagePathService.getCoversPath();
    }

    public String toRelativePath(Path file) {
        return storagePathService.toRelativePath(file);
    }

    /**
     * Traverses library.root-dir, indexes new or modified PDFs, and marks removed files as is_deleted=true
     * while purging them from the Lucene index.
     */
    public synchronized ReconciliationReport reconcileLibrary() {
        Path root = getRootPath();
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            log.error("Could not create library root directory {}: {}", root, e.getMessage());
            return new ReconciliationReport(0, 0, 0);
        }

        log.info("Starting library reconciliation in {}", root);
        Map<String, Path> discoveredPdfs = new LinkedHashMap<>();

        try (Stream<Path> walk = Files.walk(root)) {
            walk.filter(Files::isRegularFile)
                    .filter(this::isPdfFile)
                    .sorted()
                    .forEach(path -> discoveredPdfs.put(toRelativePath(path), path));
        } catch (IOException e) {
            log.error("Failed scanning directory {}: {}", root, e.getMessage());
        }

        int added = 0;
        int updated = 0;
        int deleted = 0;
        int uncommittedCount = 0;

        try {
            for (Map.Entry<String, Path> entry : discoveredPdfs.entrySet()) {
                IngestionOutcome outcome = ingestOrUpdateFile(entry.getValue(), false);
                if (outcome == IngestionOutcome.ADDED) {
                    added++;
                    uncommittedCount++;
                } else if (outcome == IngestionOutcome.UPDATED) {
                    updated++;
                    uncommittedCount++;
                }
                if (uncommittedCount >= BATCH_COMMIT_INTERVAL) {
                    luceneIndexService.commit();
                    uncommittedCount = 0;
                }
            }

            List<Document> allDbDocs = documentRepository.findAll();
            for (Document doc : allDbDocs) {
                if (!doc.isDeleted() && !discoveredPdfs.containsKey(doc.getRelativePath())) {
                    markDocumentDeleted(doc, false);
                    deleted++;
                    uncommittedCount++;
                    if (uncommittedCount >= BATCH_COMMIT_INTERVAL) {
                        luceneIndexService.commit();
                        uncommittedCount = 0;
                    }
                } else if (!doc.isDeleted() && doc.getMetaTitle() != null && fileNameCleaner.isJunkOrAdTitle(doc.getMetaTitle())) {
                    doc.setMetaTitle(null);
                    if ("PDF_INFO".equals(doc.getMetadataSource())) {
                        doc.setMetadataSource(null);
                    }
                    if (doc.getPublicationYear() == null) {
                        metadataEnrichmentService.extractYearFromPathOrFileName(doc.getRelativePath(), doc.getFileName())
                                .ifPresent(doc::setPublicationYear);
                    }
                    documentRepository.save(doc);
                    log.info("Purged junk metaTitle from active document {}: relativePath={}", doc.getId(), doc.getRelativePath());
                }
            }
        } catch (IOException e) {
            log.error("Failed during batched Lucene commit in library reconciliation: {}", e.getMessage(), e);
        } finally {
            try {
                if (luceneIndexService.hasUncommittedChanges()) {
                    luceneIndexService.commit();
                }
            } catch (IOException e) {
                log.error("Failed final Lucene commit in library reconciliation: {}", e.getMessage(), e);
            }
        }

        log.info("Reconciliation complete: {} added, {} updated, {} marked deleted (total on disk: {})",
                added, updated, deleted, discoveredPdfs.size());
        return new ReconciliationReport(added, updated, deleted);
    }

    public enum IngestionOutcome {
        ADDED, UPDATED, UNCHANGED, SKIPPED_ERROR
    }

    public record ReconciliationReport(int added, int updated, int deleted) {
    }

    public synchronized IngestionOutcome ingestOrUpdateFile(Path filePath) {
        return ingestOrUpdateFile(filePath, true);
    }

    public synchronized IngestionOutcome ingestOrUpdateFile(Path filePath, boolean commitImmediately) {
        if (!Files.exists(filePath) || !Files.isRegularFile(filePath) || !isPdfFile(filePath)) {
            return IngestionOutcome.SKIPPED_ERROR;
        }

        try {
            String relPath = toRelativePath(filePath);
            String fileName = fileNameCleaner.cleanFileName(filePath.getFileName().toString());
            long fileSize = Files.size(filePath);
            Instant lastModifiedFs = Files.getLastModifiedTime(filePath).toInstant().truncatedTo(ChronoUnit.MILLIS);

            Optional<Document> existingOpt = documentRepository.findByRelativePath(relPath);
            if (existingOpt.isPresent()) {
                Document existing = existingOpt.get();
                Instant dbLastMod = existing.getLastModifiedFs() != null
                        ? existing.getLastModifiedFs().truncatedTo(ChronoUnit.MILLIS)
                        : Instant.EPOCH;

                boolean timestampChanged = Math.abs(lastModifiedFs.toEpochMilli() - dbLastMod.toEpochMilli()) > 500;
                boolean sizeChanged = !Objects.equals(existing.getFileSizeBytes(), fileSize);
                boolean nameChanged = !Objects.equals(existing.getFileName(), fileName);
                boolean titleIsJunk = existing.getMetaTitle() != null && fileNameCleaner.isJunkOrAdTitle(existing.getMetaTitle());

                if (!existing.isDeleted() && !timestampChanged && !sizeChanged) {
                    if (nameChanged || titleIsJunk) {
                        existing.setFileName(fileName);
                        if (titleIsJunk) {
                            existing.setMetaTitle(null);
                            if ("PDF_INFO".equals(existing.getMetadataSource())) {
                                existing.setMetadataSource(null);
                            }
                            if (existing.getPublicationYear() == null) {
                                metadataEnrichmentService.extractYearFromPathOrFileName(existing.getRelativePath(), fileName)
                                        .ifPresent(existing::setPublicationYear);
                            }
                        }
                        documentRepository.save(existing);
                        log.info("Updated cleaned display name / purged junk metaTitle for {}: fileName={}, metaTitle={}",
                                relPath, fileName, existing.getMetaTitle());
                        return IngestionOutcome.UPDATED;
                    }
                    return IngestionOutcome.UNCHANGED;
                }

                PdfExtractionService.ExtractedPdfData extracted = pdfExtractionService.extractPdfPages(filePath);
                if (!extracted.valid()) {
                    log.warn("Skipping corrupt modified PDF: {}", relPath);
                    return IngestionOutcome.SKIPPED_ERROR;
                }

                existing.setFileName(fileName);
                existing.setFileSizeBytes(fileSize);
                existing.setPageCount(extracted.pageCount());
                existing.setLastModifiedFs(lastModifiedFs);
                existing.setDeleted(false);
                metadataEnrichmentService.enrichDocument(existing, filePath, extracted.pageTexts(), false);
                Document saved = documentRepository.save(existing);

                deleteCachedCover(saved.getId());
                luceneIndexService.indexDocumentPages(saved, extracted.pageTexts(), commitImmediately);
                log.info("Re-indexed modified PDF: {} ({} pages, commitImmediately={})", relPath, extracted.pageCount(), commitImmediately);
                return IngestionOutcome.UPDATED;
            } else {
                PdfExtractionService.ExtractedPdfData extracted = pdfExtractionService.extractPdfPages(filePath);
                if (!extracted.valid()) {
                    log.warn("Skipping corrupt new PDF: {}", relPath);
                    return IngestionOutcome.SKIPPED_ERROR;
                }

                Document newDoc = new Document();
                newDoc.setRelativePath(relPath);
                newDoc.setFileName(fileName);
                newDoc.setFileSizeBytes(fileSize);
                newDoc.setPageCount(extracted.pageCount());
                newDoc.setLastModifiedFs(lastModifiedFs);
                newDoc.setCreatedAt(Instant.now());
                newDoc.setDeleted(false);
                metadataEnrichmentService.enrichDocument(newDoc, filePath, extracted.pageTexts(), false);

                Document saved = documentRepository.save(newDoc);
                luceneIndexService.indexDocumentPages(saved, extracted.pageTexts(), commitImmediately);
                log.info("Indexed new PDF: {} ({} pages, commitImmediately={})", relPath, extracted.pageCount(), commitImmediately);
                return IngestionOutcome.ADDED;
            }
        } catch (IOException e) {
            log.error("Failed to ingest file {}: {}", filePath, e.getMessage(), e);
            return IngestionOutcome.SKIPPED_ERROR;
        }
    }

    @Transactional
    public synchronized void handleFileDeleted(Path filePath) {
        String relPath = toRelativePath(filePath);
        documentRepository.findByRelativePath(relPath).ifPresent(doc -> {
            if (!doc.isDeleted()) {
                markDocumentDeleted(doc, true);
            }
        });
    }

    private void markDocumentDeleted(Document doc) {
        markDocumentDeleted(doc, true);
    }

    private void markDocumentDeleted(Document doc, boolean commitImmediately) {
        doc.setDeleted(true);
        documentRepository.save(doc);
        deleteCachedCover(doc.getId());
        try {
            luceneIndexService.deleteDocument(doc.getId(), commitImmediately);
            log.info("Marked document as deleted and purged from Lucene: {} (commitImmediately={})",
                    doc.getRelativePath(), commitImmediately);
        } catch (IOException e) {
            log.error("Failed to purge document {} from Lucene: {}", doc.getId(), e.getMessage());
        }
    }

    private void deleteCachedCover(UUID docId) {
        coverThumbnailService.deleteCachedCover(docId);
    }

    public boolean isPdfFile(Path path) {
        String name = path.getFileName() != null ? path.getFileName().toString().toLowerCase(Locale.ROOT) : "";
        return name.endsWith(".pdf");
    }

    /**
     * Builds a hierarchical JSON tree of active documents for sidebar navigation.
     * Constructed entirely in-memory from portable relative database paths without physical disk I/O.
     */
    public TreeNodeDto buildDirectoryTree() {
        List<DocumentRepository.DocumentTreeItem> items = documentRepository.findActiveTreeItems();
        return buildTreeFromItems(items);
    }

    public TreeNodeDto buildTreeFromItems(List<DocumentRepository.DocumentTreeItem> items) {
        DirectoryBuilder rootBuilder = new DirectoryBuilder("Library", "");

        for (DocumentRepository.DocumentTreeItem item : items) {
            String relPath = item.getRelativePath();
            if (relPath == null || relPath.isBlank()) {
                continue;
            }

            String[] segments = relPath.split("/");
            DirectoryBuilder currentDir = rootBuilder;
            StringBuilder currentPath = new StringBuilder();

            for (int i = 0; i < segments.length - 1; i++) {
                String dirName = segments[i];
                if (currentPath.length() > 0) {
                    currentPath.append("/");
                }
                currentPath.append(dirName);
                String stepPath = currentPath.toString();
                currentDir = currentDir.subDirectories.computeIfAbsent(
                        dirName,
                        name -> new DirectoryBuilder(name, stepPath)
                );
            }

            String displayName = item.getFileName() != null ? item.getFileName() : segments[segments.length - 1];
            if (displayName.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
                displayName = displayName.substring(0, displayName.length() - 4);
            }

            currentDir.files.add(new TreeNodeDto(
                    displayName,
                    relPath,
                    "file",
                    item.getId(),
                    item.getPageCount(),
                    Collections.emptyList()
            ));
        }

        return rootBuilder.toTreeNodeDto();
    }

    private static class DirectoryBuilder {
        final String name;
        final String relPath;
        final Map<String, DirectoryBuilder> subDirectories = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        final List<TreeNodeDto> files = new ArrayList<>();

        DirectoryBuilder(String name, String relPath) {
            this.name = name;
            this.relPath = relPath;
        }

        TreeNodeDto toTreeNodeDto() {
            List<TreeNodeDto> dirChildren = subDirectories.values().stream()
                    .map(DirectoryBuilder::toTreeNodeDto)
                    .toList();

            List<TreeNodeDto> sortedFiles = files.stream()
                    .sorted(Comparator.comparing(f -> f.name().toLowerCase(Locale.ROOT)))
                    .toList();

            List<TreeNodeDto> combined = new ArrayList<>(dirChildren.size() + sortedFiles.size());
            combined.addAll(dirChildren);
            combined.addAll(sortedFiles);

            return new TreeNodeDto(name, relPath, "directory", null, null, combined);
        }
    }
}

