package com.pdforever.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.file.Path;

@ConfigurationProperties(prefix = "library")
public record LibraryProperties(
        Path rootDir,
        Path luceneDir,
        long debounceMs,
        boolean watcherEnabled
) {
    public LibraryProperties {
        if (rootDir == null) {
            rootDir = Path.of("./storage");
        }
        if (luceneDir == null) {
            luceneDir = Path.of("./data/lucene-index");
        }
        if (debounceMs <= 0) {
            debounceMs = 2000L;
        }
    }
}

