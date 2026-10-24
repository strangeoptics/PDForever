package com.pdforever.service.metadata;

/**
 * Encapsulates search targets/identifiers used to query metadata providers.
 */
public record MetadataQuery(
        String doi,
        String isbn,
        String title,
        String authors
) {
    public static MetadataQuery of(String doi, String isbn) {
        return new MetadataQuery(doi, isbn, null, null);
    }

    public static MetadataQuery of(String doi, String isbn, String title, String authors) {
        return new MetadataQuery(doi, isbn, title, authors);
    }

    public boolean hasDoi() {
        return doi != null && !doi.isBlank();
    }

    public boolean hasIsbn() {
        return isbn != null && !isbn.isBlank();
    }

    public boolean hasTitle() {
        return title != null && !title.isBlank();
    }
}

