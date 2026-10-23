package com.pdforever.dto;

import java.time.Instant;
import java.util.UUID;

public record ReadingNoteDto(
        UUID id,
        UUID documentId,
        String documentTitle,
        String relativePath,
        Integer pageNumber,
        String selectedText,
        String noteMarkdown,
        BoundingBoxDto boundingBox,
        Instant createdAt,
        Instant updatedAt
) {
}

