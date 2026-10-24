package com.pdforever.service;

import com.pdforever.config.LibraryProperties;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

@Component
public class FileNameCleaner {

    private static final List<String> DEFAULT_REMOVE_LITERALS = List.of(
            "_de.downmagaz.net",
            "de.downmagaz.net",
            "downmagaz.net"
    );

    /**
     * Matches "--" and everything after it when preceded by a 4-digit year (e.g. "2021 -- ..." or "2026 -- ...").
     * Keeps the year itself intact.
     */
    private static final List<String> DEFAULT_REMOVE_REGEXES = List.of(
            "(?<=\\b(?:18|19|20)\\d{2})\\s*--.*$"
    );

    public static final Pattern URL_OR_DOMAIN_PATTERN = Pattern.compile(
            "^(https?://|www\\.)?[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)*\\.(net|com|org|info|biz|ru|to|io|me|cc|ws|online|site|club|vip|top|xyz|de|fr|uk|nl|it|es|eu)(/.*)?$",
            Pattern.CASE_INSENSITIVE
    );

    private static final Set<String> JUNK_TITLE_KEYWORDS = Set.of(
            "untitled", "scan", "scanner", "scanned document",
            "microsoft word", "adobe acrobat", "quarkxpress", "indesign",
            "coreldraw", "canva", "unknown", "default", "test", "sample",
            "document", "presentation"
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

    public boolean isJunkOrAdTitle(String title) {
        if (title == null || title.isBlank()) {
            return true;
        }
        String trimmed = title.strip();
        String lower = trimmed.toLowerCase(Locale.ROOT);

        if (JUNK_TITLE_KEYWORDS.contains(lower)
                || lower.startsWith("microsoft word")
                || lower.endsWith(".pdf")
                || lower.endsWith(".doc")
                || lower.endsWith(".docx")) {
            return true;
        }

        if (URL_OR_DOMAIN_PATTERN.matcher(trimmed).matches()) {
            return true;
        }

        for (String literal : removeLiterals) {
            if (literal != null && !literal.isBlank()) {
                String cleanLit = literal.replaceAll("^[_\\-\\s.]+", "").strip().toLowerCase(Locale.ROOT);
                if (!cleanLit.isEmpty() && lower.equals(cleanLit)) {
                    return true;
                }
            }
        }
        return false;
    }

    public String cleanTitle(String title) {
        if (title == null || title.isBlank() || isJunkOrAdTitle(title)) {
            return null;
        }
        String cleaned = title.strip();
        for (String literal : removeLiterals) {
            if (literal != null && !literal.isBlank()) {
                cleaned = cleaned.replaceAll("(?i)[_\\-\\s.]*" + Pattern.quote(literal) + "[_\\-\\s.]*", " ");
            }
        }
        for (Pattern pattern : removePatterns) {
            cleaned = pattern.matcher(cleaned).replaceAll("");
        }
        cleaned = cleaned.replaceAll("^[_\\-\\s.]+", "").replaceAll("[_\\-\\s.]+$", "").strip();
        return isJunkOrAdTitle(cleaned) ? null : cleaned;
    }

    public String cleanFileName(String rawFileName) {
        if (rawFileName == null || rawFileName.isBlank()) {
            return rawFileName;
        }

        String ext = "";
        String lower = rawFileName.toLowerCase(Locale.ROOT);
        int lastDot = rawFileName.lastIndexOf('.');
        if (lastDot > 0 && lastDot < rawFileName.length() - 1) {
            String candidateExt = lower.substring(lastDot);
            if (candidateExt.equals(".pdf") || candidateExt.equals(".epub") || candidateExt.equals(".mobi")
                    || candidateExt.equals(".azw") || candidateExt.equals(".azw3")) {
                ext = candidateExt;
            }
        }

        String stem = !ext.isEmpty() ? rawFileName.substring(0, rawFileName.length() - ext.length()) : rawFileName;

        // 1. Remove literal substrings (case-insensitive) including leading separators
        for (String literal : removeLiterals) {
            if (literal != null && !literal.isEmpty()) {
                stem = stem.replaceAll("(?i)[_\\-\\s.]*" + Pattern.quote(literal), "");
            }
        }

        // 2. Apply regex removals (e.g. everything after a year + "--")
        for (Pattern pattern : removePatterns) {
            stem = pattern.matcher(stem).replaceAll("");
        }

        // 3. Clean up trailing spaces or dangling separators
        stem = stem.replaceAll("[_\\-\\s]+$", "")
                   .replaceAll("^[_\\-\\s]+", "")
                   .strip();

        if (stem.isEmpty()) {
            return rawFileName;
        }

        return !ext.isEmpty() ? stem + ext : stem;
    }
}
