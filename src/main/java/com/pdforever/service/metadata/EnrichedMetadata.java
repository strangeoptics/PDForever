package com.pdforever.service.metadata;

/**
 * Standard data record returned by metadata providers.
 */
public record EnrichedMetadata(
        String doi,
        String isbn,
        String title,
        String authors,
        Integer publicationYear,
        String abstractText,
        String source
) {
}

