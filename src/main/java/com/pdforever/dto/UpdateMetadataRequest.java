package com.pdforever.dto;

public record UpdateMetadataRequest(
        String doi,
        String isbn,
        String metaTitle,
        String authors,
        Integer publicationYear,
        String abstractText
) {
}

