package com.pdforever.dto;

import java.util.List;

public record DocumentFacetsDto(
        int totalDocuments,
        int unreadCount,
        int readingCount,
        int completedCount,
        int withNotesCount,
        int totalNotesCount,
        int withMetadataCount,
        int shortDocsCount,
        int mediumDocsCount,
        int longDocsCount,
        int minPageCount,
        int maxPageCount,
        Integer minPublicationYear,
        Integer maxPublicationYear,
        List<TagFacetDto> tags
) {
    public record TagFacetDto(
            Long id,
            String name,
            String colorHex,
            int documentCount
    ) {
    }
}

