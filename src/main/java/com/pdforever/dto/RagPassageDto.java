package com.pdforever.dto;

import java.util.UUID;

public record RagPassageDto(
        UUID documentId,
        String documentTitle,
        String relativePath,
        int pageNumber,
        String passageText,
        float score
) {
}

