package com.pdforever.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.file.Path;
import java.util.List;

@ConfigurationProperties(prefix = "library")
public record LibraryProperties(
        Path rootDir,
        Path luceneDir,
        Path coversDir,
        long debounceMs,
        boolean watcherEnabled,
        List<String> cleanRemoveLiterals,
        List<String> cleanRemoveRegexes
) {
    public LibraryProperties {
        if (rootDir == null) {
            rootDir = Path.of("./storage");
        }
        if (luceneDir == null) {
            luceneDir = Path.of("./data/lucene-index");
        }
        if (coversDir == null) {
            coversDir = Path.of("./data/covers");
        }
        if (debounceMs <= 0) {
            debounceMs = 2000L;
        }
    }
}

