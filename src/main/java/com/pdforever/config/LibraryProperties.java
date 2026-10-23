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
        List<String> cleanRemoveRegexes,
        RagProperties rag
) {
    public record RagProperties(
            boolean enabled,
            String ollamaUrl,
            String model,
            int maxPassages
    ) {
        public RagProperties {
            if (ollamaUrl == null || ollamaUrl.isBlank()) {
                ollamaUrl = "http://localhost:11434";
            }
            if (model == null || model.isBlank()) {
                model = "qwen2.5:14b";
            }
            if (maxPassages <= 0) {
                maxPassages = 6;
            }
        }
    }

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
        if (rag == null) {
            rag = new RagProperties(true, "http://localhost:11434", "qwen2.5:14b", 6);
        }
    }
}

