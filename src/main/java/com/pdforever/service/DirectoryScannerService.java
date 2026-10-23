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

    private final LibraryProperties properties;
    private final DocumentRepository documentRepository;
    private final PdfExtractionService pdfExtractionService;
    private final LuceneIndexService luceneIndexService;
    private final FileNameCleaner fileNameCleaner;

    public DirectoryScannerService(
            LibraryProperties properties,
            DocumentRepository documentRepository,
            PdfExtractionService pdfExtractionService,
            LuceneIndexService luceneIndexService,
            FileNameCleaner fileNameCleaner
    ) {
        this.properties = properties;
        this.documentRepository = documentRepository;
        this.pdfExtractionService = pdfExtractionService;
        this.luceneIndexService = luceneIndexService;
        this.fileNameCleaner = fileNameCleaner;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        reconcileLibrary();
    }

    public Path getRootPath() {
        return properties.rootDir().toAbsolutePath().normalize();
    }

    public String toRelativePath(Path file) {
        Path root = getRootPath();
        Path normalizedFile = file.toAbsolutePath().normalize();
        return root.relativize(normalizedFile).toString().replace('\\', '/');
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

        for (Map.Entry<String, Path> entry : discoveredPdfs.entrySet()) {
            IngestionOutcome outcome = ingestOrUpdateFile(entry.getValue());
            if (outcome == IngestionOutcome.ADDED) added++;
            else if (outcome == IngestionOutcome.UPDATED) updated++;
        }

        List<Document> allDbDocs = documentRepository.findAll();
        for (Document doc : allDbDocs) {
            if (!doc.isDeleted() && !discoveredPdfs.containsKey(doc.getRelativePath())) {
                markDocumentDeleted(doc);
                deleted++;
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

                if (!existing.isDeleted() && !timestampChanged && !sizeChanged) {
                    if (nameChanged) {
                        existing.setFileName(fileName);
                        documentRepository.save(existing);
                        log.info("Updated cleaned display name for {}: {}", relPath, fileName);
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
                Document saved = documentRepository.save(existing);

                luceneIndexService.indexDocumentPages(saved, extracted.pageTexts());
                log.info("Re-indexed modified PDF: {} ({} pages)", relPath, extracted.pageCount());
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

                Document saved = documentRepository.save(newDoc);
                luceneIndexService.indexDocumentPages(saved, extracted.pageTexts());
                log.info("Indexed new PDF: {} ({} pages)", relPath, extracted.pageCount());
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
                markDocumentDeleted(doc);
            }
        });
    }

    private void markDocumentDeleted(Document doc) {
        doc.setDeleted(true);
        documentRepository.save(doc);
        try {
            luceneIndexService.deleteDocument(doc.getId());
            log.info("Marked document as deleted and purged from Lucene: {}", doc.getRelativePath());
        } catch (IOException e) {
            log.error("Failed to purge document {} from Lucene: {}", doc.getId(), e.getMessage());
        }
    }

    public boolean isPdfFile(Path path) {
        String name = path.getFileName() != null ? path.getFileName().toString().toLowerCase(Locale.ROOT) : "";
        return name.endsWith(".pdf");
    }

    /**
     * Builds a hierarchical JSON tree of library.root-dir for sidebar navigation.
     */
    public TreeNodeDto buildDirectoryTree() {
        List<Document> activeDocs = documentRepository.findAllByIsDeletedFalseOrderByRelativePathAsc();
        Map<String, Document> docByRelPath = new HashMap<>();
        for (Document doc : activeDocs) {
            docByRelPath.put(doc.getRelativePath(), doc);
        }

        Path root = getRootPath();
        return buildNodeRecursive(root, "", docByRelPath);
    }

    private TreeNodeDto buildNodeRecursive(Path dir, String relPath, Map<String, Document> docByRelPath) {
        String name = relPath.isEmpty() ? "Library" : dir.getFileName().toString();
        List<TreeNodeDto> dirChildren = new ArrayList<>();
        List<TreeNodeDto> fileChildren = new ArrayList<>();

        if (Files.exists(dir) && Files.isDirectory(dir)) {
            try (Stream<Path> entries = Files.list(dir)) {
                List<Path> sorted = entries.sorted(Comparator.comparing(p -> p.getFileName().toString().toLowerCase(Locale.ROOT))).toList();
                for (Path entry : sorted) {
                    String childRel = toRelativePath(entry);
                    if (Files.isDirectory(entry)) {
                        TreeNodeDto childDir = buildNodeRecursive(entry, childRel, docByRelPath);
                        dirChildren.add(childDir);
                    } else if (Files.isRegularFile(entry) && isPdfFile(entry)) {
                        Document doc = docByRelPath.get(childRel);
                        if (doc != null && !doc.isDeleted()) {
                            fileChildren.add(new TreeNodeDto(
                                    doc.getFileName(),
                                    childRel,
                                    "file",
                                    doc.getId(),
                                    doc.getPageCount(),
                                    Collections.emptyList()
                            ));
                        }
                    }
                }
            } catch (IOException e) {
                log.warn("Error listing directory {}: {}", dir, e.getMessage());
            }
        }

        List<TreeNodeDto> combined = new ArrayList<>(dirChildren.size() + fileChildren.size());
        combined.addAll(dirChildren);
        combined.addAll(fileChildren);

        return new TreeNodeDto(name, relPath, "directory", null, null, combined);
    }
}

