package com.pdforever.dto;

public record UpdateReadingProgressRequest(
        Integer lastReadPage,
        String readingStatus
) {
}

