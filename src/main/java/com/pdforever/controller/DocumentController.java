package com.pdforever.controller;

import com.pdforever.dto.DocumentDto;
import com.pdforever.dto.TreeNodeDto;
import com.pdforever.service.DirectoryScannerService;
import com.pdforever.service.LibraryManagementService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.ResourceRegion;
import org.springframework.data.domain.Page;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

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
    public TreeNodeDto reconcileAndGetTree() {
        scannerService.reconcileLibrary();
        return scannerService.buildDirectoryTree();
    }

    @GetMapping("/documents")
    public Page<DocumentDto> listDocuments(
            @RequestParam(required = false) String path,
            @RequestParam(required = false) String tag,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size
    ) {
        return libraryService.getDocuments(path, tag, page, size);
    }

    @GetMapping("/documents/{id}")
    public DocumentDto getDocument(@PathVariable UUID id) {
        return libraryService.getDocument(id);
    }

    /**
     * Streams a PDF file with full HTTP Byte-Range (206 Partial Content) support via Spring's ResourceRegion.
     */
    @GetMapping("/documents/{id}/stream")
    public ResponseEntity<ResourceRegion> streamDocument(
            @PathVariable UUID id,
            @RequestHeader HttpHeaders headers
    ) throws IOException {
        Path pdfPath = libraryService.getDocumentFilePath(id);
        Resource resource = new FileSystemResource(pdfPath);
        long contentLength = resource.contentLength();

        List<HttpRange> ranges = headers.getRange();
        if (ranges.isEmpty()) {
            ResourceRegion fullRegion = new ResourceRegion(resource, 0, contentLength);
            return ResponseEntity.status(HttpStatus.OK)
                    .contentType(MediaType.APPLICATION_PDF)
                    .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                    .body(fullRegion);
        }

        HttpRange range = ranges.getFirst();
        long start = range.getRangeStart(contentLength);
        long end = range.getRangeEnd(contentLength);
        long rangeLength = Math.min(MAX_CHUNK_SIZE_BYTES, end - start + 1);

        ResourceRegion region = new ResourceRegion(resource, start, rangeLength);
        return ResponseEntity.status(HttpStatus.PARTIAL_CONTENT)
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                .body(region);
    }
}

