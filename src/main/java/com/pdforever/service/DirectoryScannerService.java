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
    private final EpubExtractionService epubExtractionService;
    private final MobiExtractionService mobiExtractionService;
    private final LuceneIndexService luceneIndexService;
    private final FileNameCleaner fileNameCleaner;
    private final MetadataEnrichmentService metadataEnrichmentService;
    private final AsyncMetadataEnrichmentService asyncMetadataEnrichmentService;

    public DirectoryScannerService(
            LibraryProperties properties,
            StoragePathService storagePathService,
            CoverThumbnailService coverThumbnailService,
            DocumentRepository documentRepository,
            PdfExtractionService pdfExtractionService,
            EpubExtractionService epubExtractionService,
            MobiExtractionService mobiExtractionService,
            LuceneIndexService luceneIndexService,
            FileNameCleaner fileNameCleaner,
            MetadataEnrichmentService metadataEnrichmentService,
            AsyncMetadataEnrichmentService asyncMetadataEnrichmentService
    ) {
        this.properties = properties;
        this.storagePathService = storagePathService;
        this.coverThumbnailService = coverThumbnailService;
        this.documentRepository = documentRepository;
        this.pdfExtractionService = pdfExtractionService;
        this.epubExtractionService = epubExtractionService;
        this.mobiExtractionService = mobiExtractionService;
        this.luceneIndexService = luceneIndexService;
        this.fileNameCleaner = fileNameCleaner;
        this.metadataEnrichmentService = metadataEnrichmentService;
        this.asyncMetadataEnrichmentService = asyncMetadataEnrichmentService;
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
        return reconcileLibrary(false);
    }

    public synchronized ReconciliationReport reconcileLibrary(boolean force) {
        Path root = getRootPath();
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            log.error("Could not create library root directory {}: {}", root, e.getMessage());
            return new ReconciliationReport(0, 0, 0);
        }

        log.info("Starting library reconciliation in {} (force={})", root, force);
        Map<String, Path> discoveredPdfs = new LinkedHashMap<>();

        try (Stream<Path> walk = Files.walk(root)) {
            walk.filter(Files::isRegularFile)
                    .filter(this::isSupportedDocument)
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
                IngestionOutcome outcome = ingestOrUpdateFile(entry.getValue(), false, force);
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

                if (!doc.isDeleted() && (doc.getDoi() != null || doc.getIsbn() != null)) {
                    String source = doc.getMetadataSource();
                    if (source == null || "PATH_HEURISTIC".equalsIgnoreCase(source) || "PDF_INFO".equalsIgnoreCase(source)) {
                        asyncMetadataEnrichmentService.enqueue(doc.getId());
                    }
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
        return ingestOrUpdateFile(filePath, true, false);
    }

    public synchronized IngestionOutcome ingestOrUpdateFile(Path filePath, boolean commitImmediately) {
        return ingestOrUpdateFile(filePath, commitImmediately, false);
    }

    public synchronized IngestionOutcome ingestOrUpdateFile(Path filePath, boolean commitImmediately, boolean force) {
        if (!Files.exists(filePath) || !Files.isRegularFile(filePath) || !isSupportedDocument(filePath)) {
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

                if (!force && !existing.isDeleted() && !timestampChanged && !sizeChanged) {
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

                Document targetDoc = existing;
                boolean isNew = false;
                List<String> pageTexts;
                int pageCount;

                if (isEpubFile(filePath)) {
                    EpubExtractionService.ExtractedEpubData epubData = epubExtractionService.extractEpubData(filePath);
                    if (!epubData.valid()) {
                        log.warn("Skipping corrupt modified EPUB: {}", relPath);
                        return IngestionOutcome.SKIPPED_ERROR;
                    }
                    pageCount = epubData.chapterCount();
                    pageTexts = epubData.chapterTexts();
                    targetDoc.setFormat("EPUB");
                    if (epubData.title() != null && !epubData.title().isBlank()) {
                        targetDoc.setMetaTitle(epubData.title());
                    }
                    if (epubData.authors() != null && !epubData.authors().isBlank()) {
                        targetDoc.setAuthors(epubData.authors());
                    }
                    if (epubData.publicationYear() != null) {
                        targetDoc.setPublicationYear(epubData.publicationYear());
                    }
                    if (epubData.description() != null && !epubData.description().isBlank()) {
                        targetDoc.setAbstractText(epubData.description());
                    }
                    if (epubData.identifier() != null) {
                        metadataEnrichmentService.extractIsbn(epubData.identifier()).ifPresent(targetDoc::setIsbn);
                        metadataEnrichmentService.extractDoi(epubData.identifier()).ifPresent(targetDoc::setDoi);
                    }
                    targetDoc.setMetadataSource("EPUB_METADATA");
                } else if (isMobiOrAzwFile(filePath)) {
                    MobiExtractionService.ExtractedMobiData mobiData = mobiExtractionService.extractMobiData(filePath);
                    if (!mobiData.valid()) {
                        log.warn("Skipping corrupt modified MOBI/AZW: {}", relPath);
                        return IngestionOutcome.SKIPPED_ERROR;
                    }
                    pageCount = mobiData.chapterCount();
                    pageTexts = mobiData.chapterTexts();
                    String lowerName = filePath.getFileName().toString().toLowerCase(Locale.ROOT);
                    targetDoc.setFormat(lowerName.endsWith(".azw") || lowerName.endsWith(".azw3") ? "AZW" : "MOBI");
                    if (mobiData.title() != null && !mobiData.title().isBlank()) {
                        targetDoc.setMetaTitle(mobiData.title());
                    }
                    if (mobiData.authors() != null && !mobiData.authors().isBlank()) {
                        targetDoc.setAuthors(mobiData.authors());
                    }
                    if (mobiData.publicationYear() != null) {
                        targetDoc.setPublicationYear(mobiData.publicationYear());
                    }
                    if (mobiData.description() != null && !mobiData.description().isBlank()) {
                        targetDoc.setAbstractText(mobiData.description());
                    }
                    if (mobiData.identifier() != null && !mobiData.identifier().isBlank()) {
                        metadataEnrichmentService.extractIsbn(mobiData.identifier()).ifPresent(targetDoc::setIsbn);
                    }
                    targetDoc.setMetadataSource("MOBI_METADATA");
                } else {
                    PdfExtractionService.ExtractedPdfData extracted = pdfExtractionService.extractPdfPages(filePath);
                    if (!extracted.valid()) {
                        log.warn("Skipping corrupt modified PDF: {}", relPath);
                        return IngestionOutcome.SKIPPED_ERROR;
                    }
                    pageCount = extracted.pageCount();
                    pageTexts = extracted.pageTexts();
                    targetDoc.setFormat("PDF");
                }

                targetDoc.setFileName(fileName);
                targetDoc.setFileSizeBytes(fileSize);
                targetDoc.setPageCount(pageCount);
                targetDoc.setLastModifiedFs(lastModifiedFs);
                targetDoc.setDeleted(false);
                metadataEnrichmentService.enrichDocument(targetDoc, filePath, pageTexts, false, false);
                Document saved = documentRepository.save(targetDoc);
                if (saved.getDoi() != null || saved.getIsbn() != null) {
                    asyncMetadataEnrichmentService.enqueue(saved.getId());
                }

                deleteCachedCover(saved.getId());
                luceneIndexService.indexDocumentPages(saved, pageTexts, commitImmediately);
                log.info("Re-indexed modified document: {} ({} pages/chapters, commitImmediately={})", relPath, pageCount, commitImmediately);
                return IngestionOutcome.UPDATED;
            } else {
                Document newDoc = new Document();
                newDoc.setRelativePath(relPath);
                newDoc.setCreatedAt(Instant.now());
                List<String> pageTexts;
                int pageCount;

                if (isEpubFile(filePath)) {
                    EpubExtractionService.ExtractedEpubData epubData = epubExtractionService.extractEpubData(filePath);
                    if (!epubData.valid()) {
                        log.warn("Skipping corrupt new EPUB: {}", relPath);
                        return IngestionOutcome.SKIPPED_ERROR;
                    }
                    pageCount = epubData.chapterCount();
                    pageTexts = epubData.chapterTexts();
                    newDoc.setFormat("EPUB");
                    if (epubData.title() != null && !epubData.title().isBlank()) {
                        newDoc.setMetaTitle(epubData.title());
                    }
                    if (epubData.authors() != null && !epubData.authors().isBlank()) {
                        newDoc.setAuthors(epubData.authors());
                    }
                    if (epubData.publicationYear() != null) {
                        newDoc.setPublicationYear(epubData.publicationYear());
                    }
                    if (epubData.description() != null && !epubData.description().isBlank()) {
                        newDoc.setAbstractText(epubData.description());
                    }
                    if (epubData.identifier() != null) {
                        metadataEnrichmentService.extractIsbn(epubData.identifier()).ifPresent(newDoc::setIsbn);
                        metadataEnrichmentService.extractDoi(epubData.identifier()).ifPresent(newDoc::setDoi);
                    }
                    newDoc.setMetadataSource("EPUB_METADATA");
                } else if (isMobiOrAzwFile(filePath)) {
                    MobiExtractionService.ExtractedMobiData mobiData = mobiExtractionService.extractMobiData(filePath);
                    if (!mobiData.valid()) {
                        log.warn("Skipping corrupt new MOBI/AZW: {}", relPath);
                        return IngestionOutcome.SKIPPED_ERROR;
                    }
                    pageCount = mobiData.chapterCount();
                    pageTexts = mobiData.chapterTexts();
                    String lowerName = filePath.getFileName().toString().toLowerCase(Locale.ROOT);
                    newDoc.setFormat(lowerName.endsWith(".azw") || lowerName.endsWith(".azw3") ? "AZW" : "MOBI");
                    if (mobiData.title() != null && !mobiData.title().isBlank()) {
                        newDoc.setMetaTitle(mobiData.title());
                    }
                    if (mobiData.authors() != null && !mobiData.authors().isBlank()) {
                        newDoc.setAuthors(mobiData.authors());
                    }
                    if (mobiData.publicationYear() != null) {
                        newDoc.setPublicationYear(mobiData.publicationYear());
                    }
                    if (mobiData.description() != null && !mobiData.description().isBlank()) {
                        newDoc.setAbstractText(mobiData.description());
                    }
                    if (mobiData.identifier() != null && !mobiData.identifier().isBlank()) {
                        metadataEnrichmentService.extractIsbn(mobiData.identifier()).ifPresent(newDoc::setIsbn);
                    }
                    newDoc.setMetadataSource("MOBI_METADATA");
                } else {
                    PdfExtractionService.ExtractedPdfData extracted = pdfExtractionService.extractPdfPages(filePath);
                    if (!extracted.valid()) {
                        log.warn("Skipping corrupt new PDF: {}", relPath);
                        return IngestionOutcome.SKIPPED_ERROR;
                    }
                    pageCount = extracted.pageCount();
                    pageTexts = extracted.pageTexts();
                    newDoc.setFormat("PDF");
                }

                newDoc.setFileName(fileName);
                newDoc.setFileSizeBytes(fileSize);
                newDoc.setPageCount(pageCount);
                newDoc.setLastModifiedFs(lastModifiedFs);
                newDoc.setDeleted(false);
                metadataEnrichmentService.enrichDocument(newDoc, filePath, pageTexts, false, false);

                Document saved = documentRepository.save(newDoc);
                if (saved.getDoi() != null || saved.getIsbn() != null) {
                    asyncMetadataEnrichmentService.enqueue(saved.getId());
                }
                luceneIndexService.indexDocumentPages(saved, pageTexts, commitImmediately);
                log.info("Indexed new document: {} ({} pages/chapters, commitImmediately={})", relPath, pageCount, commitImmediately);
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

    public boolean isSupportedDocument(Path path) {
        return isPdfFile(path) || isEpubFile(path) || isMobiOrAzwFile(path);
    }

    public boolean isEpubFile(Path path) {
        String name = path.getFileName() != null ? path.getFileName().toString().toLowerCase(Locale.ROOT) : "";
        return name.endsWith(".epub");
    }

    public boolean isMobiOrAzwFile(Path path) {
        return mobiExtractionService.isMobiOrAzwFile(path);
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
            String lower = displayName.toLowerCase(Locale.ROOT);
            if (lower.endsWith(".pdf")) {
                displayName = displayName.substring(0, displayName.length() - 4);
            } else if (lower.endsWith(".epub") || lower.endsWith(".mobi") || lower.endsWith(".azw3")) {
                displayName = displayName.substring(0, displayName.length() - 5);
            } else if (lower.endsWith(".azw")) {
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

