package com.pdforever.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pdforever.domain.Document;
import com.pdforever.domain.ReadingNote;
import com.pdforever.domain.Tag;
import com.pdforever.dto.BoundingBoxDto;
import com.pdforever.dto.DocumentDto;
import com.pdforever.dto.ReadingNoteDto;
import com.pdforever.dto.TagDto;
import com.pdforever.repository.ReadingNoteRepository;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
public class DocumentDtoMapper {

    private final ReadingNoteRepository noteRepository;
    private final MetadataEnrichmentService metadataEnrichmentService;
    private final FileNameCleaner fileNameCleaner;
    private final ObjectMapper objectMapper;

    public DocumentDtoMapper(
            ReadingNoteRepository noteRepository,
            MetadataEnrichmentService metadataEnrichmentService,
            FileNameCleaner fileNameCleaner,
            ObjectMapper objectMapper
    ) {
        this.noteRepository = noteRepository;
        this.metadataEnrichmentService = metadataEnrichmentService;
        this.fileNameCleaner = fileNameCleaner;
        this.objectMapper = objectMapper;
    }

    public DocumentDto toDocumentDto(Document doc) {
        int noteCount = doc.getId() != null ? noteRepository.countByDocumentId(doc.getId()) : 0;
        return toDocumentDto(doc, noteCount);
    }

    public DocumentDto toDocumentDto(Document doc, int noteCount) {
        List<TagDto> sortedTags = doc.getTags().stream()
                .sorted(Comparator.comparing(Tag::getName, String.CASE_INSENSITIVE_ORDER))
                .map(this::toTagDto)
                .toList();

        String metaTitle = doc.getMetaTitle();
        if (metaTitle != null && fileNameCleaner.isJunkOrAdTitle(metaTitle)) {
            metaTitle = null;
        }

        return new DocumentDto(
                doc.getId(),
                doc.getRelativePath(),
                doc.getFileName(),
                doc.getFileSizeBytes(),
                doc.getPageCount(),
                doc.getLastModifiedFs(),
                doc.getCreatedAt(),
                sortedTags,
                doc.getReadingStatus(),
                doc.getLastReadPage(),
                doc.getLastOpenedAt(),
                doc.getDoi(),
                doc.getIsbn(),
                metaTitle,
                doc.getAuthors(),
                resolvePublicationYear(doc),
                doc.getAbstractText(),
                doc.getMetadataSource(),
                doc.getMetadataEnrichedAt(),
                noteCount
        );
    }

    public TagDto toTagDto(Tag tag) {
        return new TagDto(tag.getId(), tag.getName(), tag.getColorHex());
    }

    public ReadingNoteDto toReadingNoteDto(ReadingNote note) {
        Document doc = note.getDocument();
        return new ReadingNoteDto(
                note.getId(),
                doc.getId(),
                doc.getFileName(),
                doc.getRelativePath(),
                note.getPageNumber(),
                note.getSelectedText(),
                note.getNoteMarkdown(),
                deserializeBoundingBox(note.getBoundingBoxJson()),
                note.getCreatedAt(),
                note.getUpdatedAt()
        );
    }

    public Map<UUID, Integer> loadNoteCountsForDocuments(Collection<UUID> docIds) {
        if (docIds == null || docIds.isEmpty()) {
            return Collections.emptyMap();
        }
        List<Object[]> rows = noteRepository.countNotesByDocumentIds(docIds);
        Map<UUID, Integer> map = new HashMap<>(rows.size());
        for (Object[] row : rows) {
            if (row != null && row.length >= 2 && row[0] instanceof UUID docId) {
                int count = row[1] instanceof Number n ? n.intValue() : 0;
                map.put(docId, count);
            }
        }
        return map;
    }

    public Integer resolvePublicationYear(Document doc) {
        if (doc.getPublicationYear() != null && doc.getPublicationYear() > 0) {
            return doc.getPublicationYear();
        }
        return metadataEnrichmentService
                .extractYearFromPathOrFileName(doc.getRelativePath(), doc.getFileName())
                .orElse(null);
    }

    public String serializeBoundingBox(BoundingBoxDto bbox) {
        try {
            return objectMapper.writeValueAsString(bbox);
        } catch (JsonProcessingException e) {
            return "{\"x1\":0.1,\"y1\":0.1,\"x2\":0.9,\"y2\":0.15}";
        }
    }

    public BoundingBoxDto deserializeBoundingBox(String json) {
        if (json == null || json.isBlank()) {
            return new BoundingBoxDto(0.1, 0.1, 0.9, 0.15);
        }
        try {
            return objectMapper.readValue(json, BoundingBoxDto.class);
        } catch (JsonProcessingException e) {
            return new BoundingBoxDto(0.1, 0.1, 0.9, 0.15);
        }
    }
}

