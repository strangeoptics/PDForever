package com.pdforever.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record DocumentDto(
        UUID id,
        String relativePath,
        String fileName,
        Long fileSizeBytes,
        Integer pageCount,
        Instant lastModifiedFs,
        Instant createdAt,
        List<TagDto> tags,
        String readingStatus,
        Integer lastReadPage,
        Instant lastOpenedAt,
        String doi,
        String isbn,
        String metaTitle,
        String authors,
        Integer publicationYear,
        String abstractText,
        String metadataSource,
        Instant metadataEnrichedAt,
        int noteCount,
        String format
) {
}

