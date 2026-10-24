package com.pdforever.service;

import com.pdforever.domain.Document;
import com.pdforever.dto.DocumentDto;
import com.pdforever.dto.UpdateReadingProgressRequest;
import com.pdforever.repository.DocumentRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.*;

@Service
public class DocumentReadingProgressService {

    private static final Set<String> VALID_READING_STATUSES = Set.of("UNREAD", "READING", "COMPLETED");

    private final DocumentRepository documentRepository;
    private final DocumentDtoMapper mapper;

    public DocumentReadingProgressService(
            DocumentRepository documentRepository,
            DocumentDtoMapper mapper
    ) {
        this.documentRepository = documentRepository;
        this.mapper = mapper;
    }

    @Transactional
    public DocumentDto updateReadingProgress(UUID id, UpdateReadingProgressRequest request) {
        Document doc = documentRepository.findById(id)
                .filter(d -> !d.isDeleted())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found: " + id));

        int maxPage = Math.max(1, doc.getPageCount() != null ? doc.getPageCount() : 1);

        if (request.lastReadPage() != null) {
            int clampedPage = Math.clamp(request.lastReadPage(), 1, maxPage);
            doc.setLastReadPage(clampedPage);
            doc.setLastOpenedAt(Instant.now());

            if (request.readingStatus() == null || request.readingStatus().isBlank()) {
                String currentStatus = doc.getReadingStatus();
                if ("UNREAD".equalsIgnoreCase(currentStatus)) {
                    doc.setReadingStatus("READING");
                }
            }
        }

        if (request.readingStatus() != null && !request.readingStatus().isBlank()) {
            String normalizedStatus = request.readingStatus().strip().toUpperCase(Locale.ROOT);
            if (VALID_READING_STATUSES.contains(normalizedStatus)) {
                doc.setReadingStatus(normalizedStatus);
                if ("UNREAD".equals(normalizedStatus) && request.lastReadPage() == null) {
                    doc.setLastReadPage(1);
                } else if (doc.getLastOpenedAt() == null) {
                    doc.setLastOpenedAt(Instant.now());
                }
            }
        }

        Document saved = documentRepository.save(doc);
        return mapper.toDocumentDto(saved);
    }

    @Transactional(readOnly = true)
    public List<DocumentDto> getRecentDocuments(int limit) {
        int clampedLimit = Math.clamp(limit, 1, 24);
        List<Document> docs = documentRepository.findRecentlyReadDocuments(PageRequest.of(0, clampedLimit));
        if (docs.isEmpty()) {
            return Collections.emptyList();
        }
        List<UUID> docIds = docs.stream().map(Document::getId).toList();
        Map<UUID, Integer> noteCounts = mapper.loadNoteCountsForDocuments(docIds);
        return docs.stream()
                .map(d -> mapper.toDocumentDto(d, noteCounts.getOrDefault(d.getId(), 0)))
                .toList();
    }
}

