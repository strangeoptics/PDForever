package com.pdforever.service.metadata;

import org.springframework.core.Ordered;

import java.util.Optional;

/**
 * Pluggable SPI interface for metadata providers (e.g. CrossRef, Semantic Scholar, OpenLibrary, arXiv).
 */
public interface MetadataProvider extends Ordered {

    /**
     * Unique identifier/name of the provider (e.g. "CrossRef", "SemanticScholar", "OpenLibrary").
     */
    String getName();

    /**
     * Indicates whether this provider can handle the given query identifiers.
     */
    boolean supports(MetadataQuery query);

    /**
     * Attempts to query external catalog/API for metadata matching the query.
     */
    Optional<EnrichedMetadata> lookup(MetadataQuery query);

    @Override
    default int getOrder() {
        return 0;
    }
}

