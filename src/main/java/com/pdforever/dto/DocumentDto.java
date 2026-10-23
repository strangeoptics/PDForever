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
        List<TagDto> tags
) {
}

