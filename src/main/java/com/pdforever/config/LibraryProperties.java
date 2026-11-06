package com.pdforever.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.ConstructorBinding;

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
        RagProperties rag,
        AdRemovalProperties adRemoval
) {
    public LibraryProperties(
            Path rootDir,
            Path luceneDir,
            Path coversDir,
            long debounceMs,
            boolean watcherEnabled,
            List<String> cleanRemoveLiterals,
            List<String> cleanRemoveRegexes,
            RagProperties rag
    ) {
        this(rootDir, luceneDir, coversDir, debounceMs, watcherEnabled, cleanRemoveLiterals, cleanRemoveRegexes, rag, null);
    }

    public record RagProperties(
            boolean enabled,
            String ollamaUrl,
            String model,
            int maxPassages,
            String provider,
            String apiKey
    ) {
        public RagProperties(boolean enabled, String ollamaUrl, String model, int maxPassages) {
            this(enabled, ollamaUrl, model, maxPassages, "ollama", null);
        }

        @ConstructorBinding
        public RagProperties {
            if (ollamaUrl == null || ollamaUrl.isBlank()) {
                ollamaUrl = "http://127.0.0.1:11434";
            }
            if (model == null || model.isBlank()) {
                model = "qwen2.5:14b";
            }
            if (maxPassages <= 0) {
                maxPassages = 12;
            }
            if (provider == null || provider.isBlank()) {
                provider = "ollama";
            }
        }
    }

    public record AdRemovalProperties(
            String ollamaUrl,
            String model,
            Double minConfidence,
            Integer dpi,
            Boolean dryRun
    ) {
        public AdRemovalProperties {
            if (ollamaUrl == null || ollamaUrl.isBlank()) {
                ollamaUrl = "http://127.0.0.1:11434";
            }
            if (model == null || model.isBlank()) {
                model = "qwen2.5vl";
            }
            if (minConfidence == null || !Double.isFinite(minConfidence) || minConfidence < 0.0 || minConfidence > 1.0) {
                minConfidence = 0.75;
            }
            if (dpi == null || dpi <= 0) {
                dpi = 140;
            }
            if (dryRun == null) {
                dryRun = true;
            }
        }
    }

    @ConstructorBinding
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
            rag = new RagProperties(true, "http://127.0.0.1:11434", "qwen2.5:14b", 12);
        }
        if (adRemoval == null) {
            adRemoval = new AdRemovalProperties(
                    rag.ollamaUrl(),
                    "qwen2.5vl",
                    0.75,
                    140,
                    true
            );
        }
    }
}


