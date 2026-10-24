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
        int pdfCount,
        int epubCount,
        int mobiCount,
        List<TagFacetDto> tags
) {
    public DocumentFacetsDto(
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
        this(
                totalDocuments, unreadCount, readingCount, completedCount,
                withNotesCount, totalNotesCount, withMetadataCount,
                shortDocsCount, mediumDocsCount, longDocsCount,
                minPageCount, maxPageCount, minPublicationYear, maxPublicationYear,
                0, 0, 0, tags
        );
    }

    public record TagFacetDto(
            Long id,
            String name,
            String colorHex,
            int documentCount
    ) {
    }
}

