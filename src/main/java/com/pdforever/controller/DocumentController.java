package com.pdforever.controller;

import com.pdforever.dto.DocumentDto;
import com.pdforever.dto.DocumentFacetsDto;
import com.pdforever.dto.DocumentFilterCriteria;
import com.pdforever.dto.MetadataEnrichmentReportDto;
import com.pdforever.dto.TocItemDto;
import com.pdforever.dto.TreeNodeDto;
import com.pdforever.dto.UpdateMetadataRequest;
import com.pdforever.dto.UpdateReadingProgressRequest;
import com.pdforever.service.DirectoryScannerService;
import com.pdforever.service.EpubExtractionService;
import com.pdforever.service.LibraryManagementService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.ResourceRegion;
import org.springframework.data.domain.Page;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api")
public class DocumentController {

    /**
     * Maximum chunk size per HTTP Range response (2 MB) so large PDFs (200 MB+)
     * are streamed on-demand in 1-2 MB slices without loading into RAM.
     */
    private static final long MAX_CHUNK_SIZE_BYTES = 2L * 1024L * 1024L;

    private final DirectoryScannerService scannerService;
    private final LibraryManagementService libraryService;

    public DocumentController(
            DirectoryScannerService scannerService,
            LibraryManagementService libraryService
    ) {
        this.scannerService = scannerService;
        this.libraryService = libraryService;
    }

    @GetMapping("/tree")
    public TreeNodeDto getDirectoryTree() {
        return scannerService.buildDirectoryTree();
    }

    @PostMapping("/tree/reconcile")
    public TreeNodeDto reconcileAndGetTree(
            @RequestParam(defaultValue = "false") boolean force
    ) {
        scannerService.reconcileLibrary(force);
        return scannerService.buildDirectoryTree();
    }

    @PostMapping("/documents/{id}/reindex")
    public DocumentDto reindexDocument(@PathVariable UUID id) {
        Path filePath = libraryService.getDocumentFilePath(id);
        scannerService.ingestOrUpdateFile(filePath, true, true);
        return libraryService.getDocument(id);
    }

    @GetMapping("/documents")
    public Page<DocumentDto> listDocuments(
            @RequestParam(required = false) String path,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String format,
            @RequestParam(required = false) Integer minPages,
            @RequestParam(required = false) Integer maxPages,
            @RequestParam(required = false) Boolean hasNotes,
            @RequestParam(required = false) String noteQuery,
            @RequestParam(required = false) Instant modifiedAfter,
            @RequestParam(required = false) Instant modifiedBefore,
            @RequestParam(required = false) Integer yearFrom,
            @RequestParam(required = false) Integer yearTo,
            @RequestParam(required = false) Boolean hasMetadata,
            @RequestParam(defaultValue = "fileName") String sortBy,
            @RequestParam(defaultValue = "asc") String sortDir,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size
    ) {
        DocumentFilterCriteria criteria = new DocumentFilterCriteria(
                path,
                tag,
                status,
                minPages,
                maxPages,
                hasNotes,
                noteQuery,
                modifiedAfter,
                modifiedBefore,
                yearFrom,
                yearTo,
                hasMetadata,
                sortBy,
                sortDir,
                format
        );
        return libraryService.getDocuments(criteria, page, size);
    }

    @GetMapping("/documents/facets")
    public DocumentFacetsDto getDocumentFacets(
            @RequestParam(required = false) String path
    ) {
        return libraryService.getDocumentFacets(path);
    }

    @GetMapping("/documents/recent")
    public List<DocumentDto> getRecentDocuments(
            @RequestParam(defaultValue = "6") int limit
    ) {
        return libraryService.getRecentDocuments(limit);
    }

    @GetMapping("/documents/{id}")
    public DocumentDto getDocument(@PathVariable UUID id) {
        return libraryService.getDocument(id);
    }

    @GetMapping("/documents/{id}/outline")
    public List<TocItemDto> getDocumentOutline(@PathVariable UUID id) {
        return libraryService.getDocumentOutline(id);
    }

    @PutMapping("/documents/{id}/progress")
    public DocumentDto updateReadingProgress(
            @PathVariable UUID id,
            @RequestBody UpdateReadingProgressRequest request
    ) {
        return libraryService.updateReadingProgress(id, request);
    }

    @PostMapping("/documents/{id}/enrich")
    public DocumentDto enrichDocumentMetadata(@PathVariable UUID id) {
        return libraryService.enrichDocumentMetadata(id);
    }

    @PutMapping("/documents/{id}/metadata")
    public DocumentDto updateDocumentMetadata(
            @PathVariable UUID id,
            @RequestBody UpdateMetadataRequest request
    ) {
        return libraryService.updateDocumentMetadata(id, request);
    }

    @PostMapping("/documents/enrich-all")
    public MetadataEnrichmentReportDto enrichAllDocuments(
            @RequestParam(defaultValue = "false") boolean force
    ) {
        return libraryService.enrichAllDocuments(force);
    }

    /**
     * Renders (or serves from disk cache) a JPEG cover image of page 1 of the PDF document.
     */
    @GetMapping(value = "/documents/{id}/cover", produces = MediaType.IMAGE_JPEG_VALUE)
    public ResponseEntity<Resource> getDocumentCover(@PathVariable UUID id) {
        Path coverPath = libraryService.getOrCreateDocumentCover(id);
        Resource resource = new FileSystemResource(coverPath);
        long lastModified = 0;
        try {
            lastModified = Files.getLastModifiedTime(coverPath).toMillis();
        } catch (IOException ignored) {}
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .lastModified(lastModified)
                .cacheControl(CacheControl.noCache().mustRevalidate())
                .body(resource);
    }

    @DeleteMapping("/covers")
    public Map<String, Integer> clearCoverCache() {
        int deleted = libraryService.clearCoverCache();
        return Map.of("deleted", deleted);
    }

    @GetMapping("/documents/{id}/epub/chapters")
    public List<EpubExtractionService.ChapterInfo> getEpubChapters(@PathVariable UUID id) {
        return libraryService.getEpubChapters(id);
    }

    @GetMapping(value = "/documents/{id}/epub/chapter", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> getEpubChapterHtml(
            @PathVariable UUID id,
            @RequestParam(defaultValue = "1") int index
    ) throws IOException {
        String html = libraryService.getEpubChapterHtml(id, index);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("text/html; charset=UTF-8"))
                .body(html);
    }

    @GetMapping("/documents/{id}/epub/resource")
    public ResponseEntity<byte[]> getEpubResource(
            @PathVariable UUID id,
            @RequestParam String path
    ) throws IOException {
        byte[] bytes = libraryService.getEpubResource(id, path);
        String mimeType = libraryService.getEpubResourceMimeType(path);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(mimeType))
                .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS))
                .body(bytes);
    }

    @GetMapping("/documents/{id}/mobi/resource")
    public ResponseEntity<byte[]> getMobiResource(
            @PathVariable UUID id,
            @RequestParam(name = "index", defaultValue = "0") int index
    ) throws IOException {
        byte[] bytes = libraryService.getMobiResource(id, index);
        if (bytes == null || bytes.length == 0) {
            return ResponseEntity.notFound().build();
        }
        String mimeType = libraryService.getMobiResourceMimeType(bytes);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(mimeType))
                .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS))
                .body(bytes);
    }

    /**
     * Streams a document file (PDF, EPUB, MOBI, or AZW) with full HTTP Byte-Range (206 Partial Content) support via Spring's ResourceRegion.
     */
    @GetMapping("/documents/{id}/stream")
    public ResponseEntity<ResourceRegion> streamDocument(
            @PathVariable UUID id,
            @RequestHeader HttpHeaders headers
    ) throws IOException {
        Path filePath = libraryService.getDocumentFilePath(id);
        Resource resource = new FileSystemResource(filePath);
        long contentLength = resource.contentLength();

        String lowerName = filePath.getFileName().toString().toLowerCase(Locale.ROOT);
        MediaType contentType;
        if (lowerName.endsWith(".epub")) {
            contentType = MediaType.parseMediaType("application/epub+zip");
        } else if (lowerName.endsWith(".mobi")) {
            contentType = MediaType.parseMediaType("application/x-mobipocket-ebook");
        } else if (lowerName.endsWith(".azw") || lowerName.endsWith(".azw3")) {
            contentType = MediaType.parseMediaType("application/vnd.amazon.ebook");
        } else {
            contentType = MediaType.APPLICATION_PDF;
        }

        List<HttpRange> ranges = headers.getRange();
        if (ranges.isEmpty()) {
            ResourceRegion fullRegion = new ResourceRegion(resource, 0, contentLength);
            return ResponseEntity.status(HttpStatus.OK)
                    .contentType(contentType)
                    .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                    .body(fullRegion);
        }

        HttpRange range = ranges.getFirst();
        long start = range.getRangeStart(contentLength);
        long end = range.getRangeEnd(contentLength);
        long rangeLength = Math.min(MAX_CHUNK_SIZE_BYTES, end - start + 1);

        ResourceRegion region = new ResourceRegion(resource, start, rangeLength);
        return ResponseEntity.status(HttpStatus.PARTIAL_CONTENT)
                .contentType(contentType)
                .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                .body(region);
    }
}

