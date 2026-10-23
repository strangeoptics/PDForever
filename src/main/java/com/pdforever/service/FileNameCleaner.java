package com.pdforever.service;

import com.pdforever.config.LibraryProperties;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.regex.Pattern;

@Component
public class FileNameCleaner {

    private static final List<String> DEFAULT_REMOVE_LITERALS = List.of(
            "_de.downmagaz.net"
    );

    /**
     * Matches "--" and everything after it when preceded by a 4-digit year (e.g. "2021 -- ..." or "2026 -- ...").
     * Keeps the year itself intact.
     */
    private static final List<String> DEFAULT_REMOVE_REGEXES = List.of(
            "(?<=\\b(?:18|19|20)\\d{2})\\s*--.*$"
    );

    private final List<String> removeLiterals;
    private final List<Pattern> removePatterns;

    public FileNameCleaner(LibraryProperties properties) {
        List<String> configuredLiterals = properties.cleanRemoveLiterals();
        this.removeLiterals = (configuredLiterals != null && !configuredLiterals.isEmpty())
                ? configuredLiterals
                : DEFAULT_REMOVE_LITERALS;

        List<String> configuredRegexes = properties.cleanRemoveRegexes();
        List<String> activeRegexes = (configuredRegexes != null && !configuredRegexes.isEmpty())
                ? configuredRegexes
                : DEFAULT_REMOVE_REGEXES;

        this.removePatterns = activeRegexes.stream()
                .map(r -> Pattern.compile(r, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE))
                .toList();
    }

    public String cleanFileName(String rawFileName) {
        if (rawFileName == null || rawFileName.isBlank()) {
            return rawFileName;
        }

        boolean hasPdfExt = rawFileName.toLowerCase().endsWith(".pdf");
        String stem = hasPdfExt ? rawFileName.substring(0, rawFileName.length() - 4) : rawFileName;

        // 1. Remove literal substrings (case-insensitive)
        for (String literal : removeLiterals) {
            if (literal != null && !literal.isEmpty()) {
                stem = stem.replaceAll("(?i)" + Pattern.quote(literal), "");
            }
        }

        // 2. Apply regex removals (e.g. everything after a year + "--")
        for (Pattern pattern : removePatterns) {
            stem = pattern.matcher(stem).replaceAll("");
        }

        // 3. Clean up trailing spaces or dangling separators
        stem = stem.strip();

        if (stem.isEmpty()) {
            return rawFileName;
        }

        return hasPdfExt ? stem + ".pdf" : stem;
    }
}

