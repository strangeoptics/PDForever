package com.pdforever.service;

import com.pdforever.domain.Document;
import com.pdforever.repository.DocumentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Stream;

@Service
public class CoverThumbnailService {

    private static final Logger log = LoggerFactory.getLogger(CoverThumbnailService.class);

    private final StoragePathService storagePathService;
    private final DocumentRepository documentRepository;
    private final PdfExtractionService pdfExtractionService;
    private final EpubExtractionService epubExtractionService;

    public CoverThumbnailService(
            StoragePathService storagePathService,
            DocumentRepository documentRepository,
            PdfExtractionService pdfExtractionService,
            EpubExtractionService epubExtractionService
    ) {
        this.storagePathService = storagePathService;
        this.documentRepository = documentRepository;
        this.pdfExtractionService = pdfExtractionService;
        this.epubExtractionService = epubExtractionService;
    }

    public Path getCoversPath() {
        return storagePathService.getCoversPath();
    }

    public Path getRootPath() {
        return storagePathService.getRootPath();
    }

    public Path getDocumentFilePath(Document doc) {
        Path fullPath = storagePathService.resolveDocumentPath(doc.getRelativePath());
        if (!Files.exists(fullPath)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PDF file not found on disk: " + doc.getRelativePath());
        }
        return fullPath;
    }

    @Transactional(readOnly = true)
    public Path getOrCreateDocumentCover(UUID id) {
        Document doc = documentRepository.findById(id)
                .filter(d -> !d.isDeleted())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found: " + id));
        return getOrCreateDocumentCover(id, doc);
    }

    public Path getOrCreateDocumentCover(UUID id, Document doc) {
        Path pdfPath = getDocumentFilePath(doc);
        Path coverPath = storagePathService.resolveCoverPath(id);

        try {
            if (Files.exists(coverPath) && Files.size(coverPath) > 0) {
                long coverMtime = Files.getLastModifiedTime(coverPath).toMillis();
                long pdfMtime = Files.getLastModifiedTime(pdfPath).toMillis();
                if (coverMtime >= pdfMtime) {
                    return coverPath;
                }
            }
        } catch (IOException ignored) {
        }

        boolean isEpub = "EPUB".equalsIgnoreCase(doc.getFormat())
                || (doc.getRelativePath() != null && doc.getRelativePath().toLowerCase(Locale.ROOT).endsWith(".epub"))
                || (doc.getFileName() != null && doc.getFileName().toLowerCase(Locale.ROOT).endsWith(".epub"));

        boolean rendered;
        if (isEpub) {
            rendered = epubExtractionService.renderCoverImage(pdfPath, coverPath);
        } else {
            rendered = pdfExtractionService.renderCoverImage(pdfPath, coverPath);
        }
        if (!rendered || !Files.exists(coverPath)) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Could not render cover image for document: " + id);
        }
        return coverPath;
    }

    public void deleteCachedCover(UUID docId) {
        if (docId == null) return;
        try {
            Files.deleteIfExists(storagePathService.resolveCoverPath(docId));
        } catch (IOException e) {
            log.debug("Failed to delete cached cover for {}: {}", docId, e.getMessage());
        }
    }

    public int clearCoverCache() {
        Path coversDir = storagePathService.getCoversPath();
        if (!Files.exists(coversDir) || !Files.isDirectory(coversDir)) {
            return 0;
        }
        int deleted = 0;
        try (Stream<Path> files = Files.list(coversDir)) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                if (file.getFileName().toString().toLowerCase().endsWith(".jpg")) {
                    if (Files.deleteIfExists(file)) {
                        deleted++;
                    }
                }
            }
        } catch (IOException ignored) {
        }
        return deleted;
    }
}
