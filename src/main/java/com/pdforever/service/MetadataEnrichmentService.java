package com.pdforever.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pdforever.domain.Document;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.io.RandomAccessReadBufferedFile;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentInformation;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class MetadataEnrichmentService {

    private static final Logger log = LoggerFactory.getLogger(MetadataEnrichmentService.class);

    private static final String USER_AGENT = "PDForever/1.0 (In-Place Personal Library; mailto:pdforever@localhost)";
    private static final int MAX_PAGES_TO_SCAN = 3;

    /**
     * Matches standard ISO 26324 DOIs (e.g. 10.1038/s41586-019-1666-5 or 10.1145/3292500.3330701).
     */
    private static final Pattern DOI_PATTERN = Pattern.compile(
            "(?:doi\\s*[:=]?\\s*|https?://(?:dx\\.)?doi\\.org/)?\\b(10\\.\\d{4,9}/[-._;()/:A-Za-z0-9]+)",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * Matches explicit "ISBN..." declarations (ISBN-13 or ISBN-10).
     */
    private static final Pattern EXPLICIT_ISBN_PATTERN = Pattern.compile(
            "ISBN(?:-1[03])?\\s*[:=]?\\s*([0-9Xx][0-9Xx\\-–\\s]{8,18}[0-9Xx])",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * Matches standalone EAN/ISBN-13 book numbers starting with 978 or 979.
     */
    private static final Pattern ISBN13_STANDALONE_PATTERN = Pattern.compile(
            "\\b(97[89](?:[-–\\s]?\\d){10})\\b"
    );

    private static final Pattern YEAR_PATTERN = Pattern.compile("\\b(18\\d{2}|19\\d{2}|20\\d{2})\\b");

    /**
     * Matches month/issue + year patterns in filenames such as "1.23" (for 01.2023), "01.23", "12.24", or "01.2023".
     */
    private static final Pattern FILENAME_MONTH_YEAR_PATTERN = Pattern.compile(
            "(?:^|[_\\s\\-.,(\\[])(0?[1-9]|1[0-2])\\.(\\d{2}|19\\d{2}|20[0-3]\\d)(?=$|[_\\s\\-.,)\\]])"
    );

    /**
     * Matches standalone 4-digit years (1900-2039) in directory names or filenames.
     */
    private static final Pattern PATH_OR_FILENAME_YEAR_PATTERN = Pattern.compile(
            "(?:^|[/\\\\_\\s\\-.,(\\[])(19\\d{2}|20[0-3]\\d)(?=$|[/\\\\_\\s\\-.,)\\]])"
    );

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    @Value("${library.metadata-lookup-enabled:true}")
    private boolean externalLookupEnabled = true;

    public MetadataEnrichmentService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(4))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

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

    public void setExternalLookupEnabled(boolean enabled) {
        this.externalLookupEnabled = enabled;
    }

    /**
     * Scans the first 1-3 pages (plus raw filename and PDF DocumentInformation) for DOIs and ISBNs,
     * queries CrossRef / Semantic Scholar / OpenLibrary when enabled, and updates the Document entity in place.
     */
    public boolean enrichDocument(Document doc, Path pdfPath, List<String> preExtractedPages) {
        return enrichDocument(doc, pdfPath, preExtractedPages, false);
    }

    /**
     * Scans the first 1-3 pages (plus raw filename and PDF DocumentInformation) for DOIs and ISBNs,
     * queries CrossRef / Semantic Scholar / OpenLibrary when enabled, and updates the Document entity in place.
     */
    public boolean enrichDocument(Document doc, Path pdfPath, List<String> preExtractedPages, boolean force) {
        List<String> firstPages = (preExtractedPages != null && !preExtractedPages.isEmpty())
                ? preExtractedPages.subList(0, Math.min(MAX_PAGES_TO_SCAN, preExtractedPages.size()))
                : extractFirstPagesText(pdfPath, MAX_PAGES_TO_SCAN);

        StringBuilder combinedText = new StringBuilder();
        for (String pageText : firstPages) {
            if (pageText != null && !pageText.isBlank()) {
                combinedText.append(pageText).append("\n");
            }
        }
        if (pdfPath != null && pdfPath.getFileName() != null) {
            combinedText.append("\n").append(pdfPath.getFileName().toString());
        }

        String detectedDoi = doc.getDoi() != null && !doc.getDoi().isBlank()
                ? doc.getDoi()
                : extractDoi(combinedText.toString()).orElse(null);

        String detectedIsbn = doc.getIsbn() != null && !doc.getIsbn().isBlank()
                ? doc.getIsbn()
                : extractIsbn(combinedText.toString()).orElse(null);

        // Also check PDF DocumentInformation dictionary if DOI/ISBN not yet found or for fallback info
        PdfEmbeddedMeta embeddedMeta = extractPdfEmbeddedInfo(pdfPath);
        if (detectedDoi == null && embeddedMeta.doi() != null) {
            detectedDoi = embeddedMeta.doi();
        }
        if (detectedIsbn == null && embeddedMeta.isbn() != null) {
            detectedIsbn = embeddedMeta.isbn();
        }

        boolean changed = false;
        if (detectedDoi != null && !detectedDoi.equals(doc.getDoi())) {
            doc.setDoi(detectedDoi);
            changed = true;
        }
        if (detectedIsbn != null && !detectedIsbn.equals(doc.getIsbn())) {
            doc.setIsbn(detectedIsbn);
            changed = true;
        }

        // 1. Query CrossRef & Semantic Scholar if DOI is available
        if (externalLookupEnabled && detectedDoi != null) {
            Optional<EnrichedMetadata> doiMeta = lookupByDoi(detectedDoi);
            if (doiMeta.isPresent()) {
                applyMetadataToDocument(doc, doiMeta.get());
                if (doc.getPublicationYear() == null) {
                    extractYearFromPathOrFileName(doc.getRelativePath(), doc.getFileName())
                            .ifPresent(doc::setPublicationYear);
                }
                return true;
            }
        }

        // 2. Query OpenLibrary if ISBN is available
        if (externalLookupEnabled && detectedIsbn != null) {
            Optional<EnrichedMetadata> isbnMeta = lookupByIsbn(detectedIsbn);
            if (isbnMeta.isPresent()) {
                applyMetadataToDocument(doc, isbnMeta.get());
                if (doc.getPublicationYear() == null) {
                    extractYearFromPathOrFileName(doc.getRelativePath(), doc.getFileName())
                            .ifPresent(doc::setPublicationYear);
                }
                return true;
            }
        }

        Integer pathOrFileYear = extractYearFromPathOrFileName(doc.getRelativePath(), doc.getFileName()).orElse(null);

        // 3. Fallback to path/filename year heuristic and embedded PDF DocumentInformation if not yet enriched
        if (force || doc.getMetadataSource() == null || "PDF_INFO".equals(doc.getMetadataSource()) || "PATH_HEURISTIC".equals(doc.getMetadataSource())) {
            if (embeddedMeta.title() != null && (doc.getMetaTitle() == null || doc.getMetaTitle().isBlank())) {
                doc.setMetaTitle(embeddedMeta.title());
                changed = true;
            }
            if (embeddedMeta.authors() != null && (doc.getAuthors() == null || doc.getAuthors().isBlank())) {
                doc.setAuthors(embeddedMeta.authors());
                changed = true;
            }
            Integer resolvedYear = pathOrFileYear != null ? pathOrFileYear : embeddedMeta.year();
            if (resolvedYear != null && (doc.getPublicationYear() == null || (!"MANUAL".equals(doc.getMetadataSource()) && pathOrFileYear != null && !pathOrFileYear.equals(doc.getPublicationYear())))) {
                doc.setPublicationYear(resolvedYear);
                changed = true;
            }
            if (embeddedMeta.subject() != null && (doc.getAbstractText() == null || doc.getAbstractText().isBlank())) {
                doc.setAbstractText(embeddedMeta.subject());
                changed = true;
            }
            if (changed) {
                doc.setMetadataSource(pathOrFileYear != null && embeddedMeta.title() == null ? "PATH_HEURISTIC" : "PDF_INFO");
                doc.setMetadataEnrichedAt(Instant.now());
            }
        }

        return changed;
    }

    /**
     * Extracts a publication year from the relative directory path (e.g. "/2023/...")
     * or filename (e.g. "1.23" -> 2023 for 01.2023, "12.24" -> 2024, or "2021").
     */
    public Optional<Integer> extractYearFromPathOrFileName(String relativePath, String fileName) {
        String normRel = relativePath != null ? relativePath.replace('\\', '/').strip() : "";
        String rawName = fileName != null && !fileName.isBlank() ? fileName.strip() : "";
        if (rawName.isEmpty() && !normRel.isEmpty()) {
            int lastSlash = normRel.lastIndexOf('/');
            rawName = lastSlash >= 0 ? normRel.substring(lastSlash + 1) : normRel;
        }
        String nameWithoutExt = rawName.toLowerCase().endsWith(".pdf")
                ? rawName.substring(0, rawName.length() - 4)
                : rawName;

        // 1. Check filename for explicit "M.YY" / "MM.YY" / "MM.YYYY" pattern (e.g. "1.23" -> 2023)
        Matcher monthYearMatcher = FILENAME_MONTH_YEAR_PATTERN.matcher(nameWithoutExt);
        if (monthYearMatcher.find()) {
            String yearPart = monthYearMatcher.group(2);
            Integer parsed = normalizeTwoOrFourDigitYear(yearPart);
            if (parsed != null) {
                return Optional.of(parsed);
            }
        }

        // Also check the raw filename inside relativePath in case FileNameCleaner altered something
        if (!normRel.isEmpty()) {
            int lastSlash = normRel.lastIndexOf('/');
            String relFileName = lastSlash >= 0 ? normRel.substring(lastSlash + 1) : normRel;
            if (relFileName.toLowerCase().endsWith(".pdf")) {
                relFileName = relFileName.substring(0, relFileName.length() - 4);
            }
            Matcher relMonthYearMatcher = FILENAME_MONTH_YEAR_PATTERN.matcher(relFileName);
            if (relMonthYearMatcher.find()) {
                Integer parsed = normalizeTwoOrFourDigitYear(relMonthYearMatcher.group(2));
                if (parsed != null) {
                    return Optional.of(parsed);
                }
            }
        }

        // 2. Check directory segments in relativePath (e.g. "Magazines/2023/file.pdf" or "2023/file.pdf")
        if (normRel.contains("/")) {
            String dirPath = normRel.substring(0, normRel.lastIndexOf('/'));
            String[] segments = dirPath.split("/");
            for (int i = segments.length - 1; i >= 0; i--) {
                String seg = segments[i].strip();
                if (seg.matches("19\\d{2}|20[0-3]\\d")) {
                    return Optional.of(Integer.parseInt(seg));
                }
                Matcher segMatcher = PATH_OR_FILENAME_YEAR_PATTERN.matcher(seg);
                if (segMatcher.find()) {
                    return Optional.of(Integer.parseInt(segMatcher.group(1)));
                }
            }
        }

        // 3. Check filename for a standalone 4-digit year (e.g. "Berlin, 2021") after stripping any ISBNs
        String nameWithoutIsbn = ISBN13_STANDALONE_PATTERN.matcher(nameWithoutExt).replaceAll(" ");
        Matcher fileYearMatcher = PATH_OR_FILENAME_YEAR_PATTERN.matcher(nameWithoutIsbn);
        Integer lastMatchedYear = null;
        while (fileYearMatcher.find()) {
            lastMatchedYear = Integer.parseInt(fileYearMatcher.group(1));
        }
        return Optional.ofNullable(lastMatchedYear);
    }

    private Integer normalizeTwoOrFourDigitYear(String yearStr) {
        if (yearStr == null || yearStr.isBlank()) return null;
        try {
            int val = Integer.parseInt(yearStr.strip());
            if (yearStr.length() == 2) {
                if (val <= 39) {
                    return 2000 + val;
                } else if (val >= 70) {
                    return 1900 + val;
                }
                return null;
            }
            if (val >= 1900 && val <= 2039) {
                return val;
            }
        } catch (NumberFormatException ignored) {
        }
        return null;
    }

    private void applyMetadataToDocument(Document doc, EnrichedMetadata meta) {
        if (meta.doi() != null && !meta.doi().isBlank()) {
            doc.setDoi(meta.doi());
        }
        if (meta.isbn() != null && !meta.isbn().isBlank()) {
            doc.setIsbn(meta.isbn());
        }
        if (meta.title() != null && !meta.title().isBlank()) {
            doc.setMetaTitle(meta.title());
        }
        if (meta.authors() != null && !meta.authors().isBlank()) {
            doc.setAuthors(meta.authors());
        }
        if (meta.publicationYear() != null) {
            doc.setPublicationYear(meta.publicationYear());
        }
        if (meta.abstractText() != null && !meta.abstractText().isBlank()) {
            doc.setAbstractText(meta.abstractText());
        }
        if (meta.source() != null) {
            doc.setMetadataSource(meta.source());
        }
        doc.setMetadataEnrichedAt(Instant.now());
    }

    /**
     * Extracts the first valid DOI from text (typically pages 1-3).
     */
    public Optional<String> extractDoi(String text) {
        if (text == null || text.isBlank()) {
            return Optional.empty();
        }
        Matcher matcher = DOI_PATTERN.matcher(text);
        while (matcher.find()) {
            String candidate = cleanDoiCandidate(matcher.group(1));
            if (candidate.length() >= 8 && candidate.contains("/")) {
                return Optional.of(candidate);
            }
        }
        return Optional.empty();
    }

    private String cleanDoiCandidate(String raw) {
        if (raw == null) return "";
        String cleaned = raw.strip();
        while (!cleaned.isEmpty()) {
            char last = cleaned.charAt(cleaned.length() - 1);
            if (last == '.' || last == ',' || last == ';' || last == ')' || last == ']' || last == '}' || last == '\'' || last == '"') {
                cleaned = cleaned.substring(0, cleaned.length() - 1);
            } else {
                break;
            }
        }
        return cleaned;
    }

    /**
     * Extracts and checksum-validates the first ISBN-13 or ISBN-10 from text (pages 1-3 or filename).
     */
    public Optional<String> extractIsbn(String text) {
        if (text == null || text.isBlank()) {
            return Optional.empty();
        }

        // 1. Check explicit "ISBN: ..." occurrences first
        Matcher explicitMatcher = EXPLICIT_ISBN_PATTERN.matcher(text);
        while (explicitMatcher.find()) {
            String normalized = normalizeIsbnDigits(explicitMatcher.group(1));
            if (isValidIsbn13(normalized) || isValidIsbn10(normalized)) {
                return Optional.of(normalized);
            }
        }

        // 2. Check standalone 978/979 ISBN-13 numbers
        Matcher isbn13Matcher = ISBN13_STANDALONE_PATTERN.matcher(text);
        while (isbn13Matcher.find()) {
            String normalized = normalizeIsbnDigits(isbn13Matcher.group(1));
            if (isValidIsbn13(normalized)) {
                return Optional.of(normalized);
            }
        }

        return Optional.empty();
    }

    private String normalizeIsbnDigits(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("[^0-9Xx]", "").toUpperCase();
    }

    public boolean isValidIsbn13(String isbn) {
        if (isbn == null || isbn.length() != 13 || (!isbn.startsWith("978") && !isbn.startsWith("979"))) {
            return false;
        }
        int sum = 0;
        for (int i = 0; i < 12; i++) {
            char c = isbn.charAt(i);
            if (!Character.isDigit(c)) return false;
            int digit = c - '0';
            sum += (i % 2 == 0) ? digit : digit * 3;
        }
        char checkChar = isbn.charAt(12);
        if (!Character.isDigit(checkChar)) return false;
        int checkDigit = (10 - (sum % 10)) % 10;
        return (checkChar - '0') == checkDigit;
    }

    public boolean isValidIsbn10(String isbn) {
        if (isbn == null || isbn.length() != 10) {
            return false;
        }
        int sum = 0;
        for (int i = 0; i < 9; i++) {
            char c = isbn.charAt(i);
            if (!Character.isDigit(c)) return false;
            sum += (c - '0') * (10 - i);
        }
        char last = isbn.charAt(9);
        int lastVal = (last == 'X') ? 10 : (Character.isDigit(last) ? (last - '0') : -1);
        if (lastVal < 0) return false;
        sum += lastVal;
        return sum % 11 == 0;
    }

    /**
     * Queries CrossRef and Semantic Scholar for a given DOI.
     */
    public Optional<EnrichedMetadata> lookupByDoi(String doi) {
        Optional<EnrichedMetadata> crossRefOpt = fetchFromCrossRef(doi);
        if (crossRefOpt.isPresent()) {
            EnrichedMetadata cr = crossRefOpt.get();
            // If CrossRef lacks an abstract, try supplementing the abstract from Semantic Scholar
            if (cr.abstractText() == null || cr.abstractText().isBlank()) {
                Optional<EnrichedMetadata> s2Opt = fetchFromSemanticScholar(doi);
                if (s2Opt.isPresent() && s2Opt.get().abstractText() != null && !s2Opt.get().abstractText().isBlank()) {
                    return Optional.of(new EnrichedMetadata(
                            cr.doi(),
                            cr.isbn(),
                            cr.title() != null ? cr.title() : s2Opt.get().title(),
                            cr.authors() != null ? cr.authors() : s2Opt.get().authors(),
                            cr.publicationYear() != null ? cr.publicationYear() : s2Opt.get().publicationYear(),
                            s2Opt.get().abstractText(),
                            "CROSSREF+SEMANTIC_SCHOLAR"
                    ));
                }
            }
            return crossRefOpt;
        }
        return fetchFromSemanticScholar(doi);
    }

    public Optional<EnrichedMetadata> fetchFromCrossRef(String doi) {
        try {
            String encodedDoi = URLEncoder.encode(doi, StandardCharsets.UTF_8);
            URI uri = URI.create("https://api.crossref.org/works/" + encodedDoi);
            HttpRequest req = HttpRequest.newBuilder(uri)
                    .header("User-Agent", USER_AGENT)
                    .header("Accept", "application/json")
                    .timeout(Duration.ofSeconds(6))
                    .GET()
                    .build();

            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200 || res.body() == null) {
                return Optional.empty();
            }
            return parseCrossRefJson(doi, res.body());
        } catch (Exception e) {
            log.debug("CrossRef lookup failed for DOI {}: {}", doi, e.getMessage());
            return Optional.empty();
        }
    }

    public Optional<EnrichedMetadata> parseCrossRefJson(String doi, String jsonBody) {
        try {
            JsonNode root = objectMapper.readTree(jsonBody);
            JsonNode msg = root.path("message");
            if (msg.isMissingNode() || msg.isNull()) {
                return Optional.empty();
            }

            String title = null;
            JsonNode titleArr = msg.path("title");
            if (titleArr.isArray() && !titleArr.isEmpty()) {
                title = cleanXmlTags(titleArr.get(0).asText(null));
            }

            List<String> authorNames = new ArrayList<>();
            JsonNode authorArr = msg.path("author");
            if (authorArr.isArray()) {
                for (JsonNode a : authorArr) {
                    String given = a.path("given").asText("").strip();
                    String family = a.path("family").asText("").strip();
                    String full = (given + " " + family).strip();
                    if (!full.isEmpty()) {
                        authorNames.add(full);
                    } else if (a.hasNonNull("name")) {
                        authorNames.add(a.path("name").asText().strip());
                    }
                }
            }
            String authors = authorNames.isEmpty() ? null : String.join(", ", authorNames);

            Integer year = extractCrossRefYear(msg.path("published-print"))
                    .or(() -> extractCrossRefYear(msg.path("published-online")))
                    .or(() -> extractCrossRefYear(msg.path("issued")))
                    .orElse(null);

            String abstractText = msg.hasNonNull("abstract")
                    ? cleanXmlTags(msg.path("abstract").asText())
                    : null;

            if (title == null && authors == null && abstractText == null) {
                return Optional.empty();
            }

            return Optional.of(new EnrichedMetadata(doi, null, title, authors, year, abstractText, "CROSSREF"));
        } catch (Exception e) {
            log.debug("Failed to parse CrossRef JSON for {}: {}", doi, e.getMessage());
            return Optional.empty();
        }
    }

    private Optional<Integer> extractCrossRefYear(JsonNode dateNode) {
        if (dateNode == null || dateNode.isMissingNode()) return Optional.empty();
        JsonNode parts = dateNode.path("date-parts");
        if (parts.isArray() && !parts.isEmpty() && parts.get(0).isArray() && !parts.get(0).isEmpty()) {
            int y = parts.get(0).get(0).asInt(0);
            if (y >= 1800 && y <= 2100) {
                return Optional.of(y);
            }
        }
        return Optional.empty();
    }

    public Optional<EnrichedMetadata> fetchFromSemanticScholar(String doi) {
        try {
            String encodedDoi = URLEncoder.encode(doi, StandardCharsets.UTF_8);
            URI uri = URI.create("https://api.semanticscholar.org/graph/v1/paper/DOI:" + encodedDoi + "?fields=title,authors,year,abstract");
            HttpRequest req = HttpRequest.newBuilder(uri)
                    .header("User-Agent", USER_AGENT)
                    .header("Accept", "application/json")
                    .timeout(Duration.ofSeconds(6))
                    .GET()
                    .build();

            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200 || res.body() == null) {
                return Optional.empty();
            }
            return parseSemanticScholarJson(doi, res.body());
        } catch (Exception e) {
            log.debug("Semantic Scholar lookup failed for DOI {}: {}", doi, e.getMessage());
            return Optional.empty();
        }
    }

    public Optional<EnrichedMetadata> parseSemanticScholarJson(String doi, String jsonBody) {
        try {
            JsonNode root = objectMapper.readTree(jsonBody);
            String title = root.hasNonNull("title") ? root.path("title").asText().strip() : null;

            List<String> authorNames = new ArrayList<>();
            JsonNode authorsNode = root.path("authors");
            if (authorsNode.isArray()) {
                for (JsonNode a : authorsNode) {
                    String name = a.path("name").asText("").strip();
                    if (!name.isEmpty()) {
                        authorNames.add(name);
                    }
                }
            }
            String authors = authorNames.isEmpty() ? null : String.join(", ", authorNames);

            Integer year = root.hasNonNull("year") && root.path("year").asInt(0) >= 1800
                    ? root.path("year").asInt()
                    : null;

            String abstractText = root.hasNonNull("abstract")
                    ? root.path("abstract").asText().strip()
                    : null;

            if (title == null && authors == null && abstractText == null) {
                return Optional.empty();
            }

            return Optional.of(new EnrichedMetadata(doi, null, title, authors, year, abstractText, "SEMANTIC_SCHOLAR"));
        } catch (Exception e) {
            log.debug("Failed to parse Semantic Scholar JSON for {}: {}", doi, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Queries OpenLibrary Books API for a given ISBN-10 or ISBN-13.
     */
    public Optional<EnrichedMetadata> lookupByIsbn(String isbn) {
        try {
            String key = "ISBN:" + isbn;
            URI uri = URI.create("https://openlibrary.org/api/books?bibkeys=" + URLEncoder.encode(key, StandardCharsets.UTF_8) + "&format=json&jscmd=data");
            HttpRequest req = HttpRequest.newBuilder(uri)
                    .header("User-Agent", USER_AGENT)
                    .header("Accept", "application/json")
                    .timeout(Duration.ofSeconds(6))
                    .GET()
                    .build();

            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200 || res.body() == null) {
                return Optional.empty();
            }
            return parseOpenLibraryJson(isbn, res.body());
        } catch (Exception e) {
            log.debug("OpenLibrary lookup failed for ISBN {}: {}", isbn, e.getMessage());
            return Optional.empty();
        }
    }

    public Optional<EnrichedMetadata> parseOpenLibraryJson(String isbn, String jsonBody) {
        try {
            JsonNode root = objectMapper.readTree(jsonBody);
            JsonNode book = root.path("ISBN:" + isbn);
            if (book.isMissingNode() || book.isNull() || book.isEmpty()) {
                return Optional.empty();
            }

            String title = book.hasNonNull("title") ? book.path("title").asText().strip() : null;
            if (title != null && book.hasNonNull("subtitle")) {
                String sub = book.path("subtitle").asText().strip();
                if (!sub.isEmpty()) {
                    title = title + " — " + sub;
                }
            }

            List<String> authorNames = new ArrayList<>();
            JsonNode authorsNode = book.path("authors");
            if (authorsNode.isArray()) {
                for (JsonNode a : authorsNode) {
                    String name = a.path("name").asText("").strip();
                    if (!name.isEmpty()) {
                        authorNames.add(name);
                    }
                }
            }
            String authors = authorNames.isEmpty() ? null : String.join(", ", authorNames);

            Integer year = null;
            if (book.hasNonNull("publish_date")) {
                Matcher ym = YEAR_PATTERN.matcher(book.path("publish_date").asText(""));
                if (ym.find()) {
                    year = Integer.parseInt(ym.group(1));
                }
            }

            String abstractText = null;
            if (book.hasNonNull("notes")) {
                JsonNode notesNode = book.path("notes");
                abstractText = notesNode.isObject() ? notesNode.path("value").asText(null) : notesNode.asText(null);
            } else if (book.path("excerpts").isArray() && !book.path("excerpts").isEmpty()) {
                abstractText = book.path("excerpts").get(0).path("text").asText(null);
            }

            if (title == null && authors == null) {
                return Optional.empty();
            }

            return Optional.of(new EnrichedMetadata(null, isbn, title, authors, year, abstractText, "OPENLIBRARY"));
        } catch (Exception e) {
            log.debug("Failed to parse OpenLibrary JSON for ISBN {}: {}", isbn, e.getMessage());
            return Optional.empty();
        }
    }

    private String cleanXmlTags(String input) {
        if (input == null) return null;
        String stripped = input.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").strip();
        return stripped.isEmpty() ? null : stripped;
    }

    private List<String> extractFirstPagesText(Path pdfPath, int maxPages) {
        if (pdfPath == null) return List.of();
        try (var randomAccessRead = new RandomAccessReadBufferedFile(pdfPath);
             PDDocument pdDocument = Loader.loadPDF(randomAccessRead)) {
            int total = Math.min(maxPages, pdDocument.getNumberOfPages());
            if (total <= 0) return List.of();

            List<String> pages = new ArrayList<>(total);
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            for (int p = 1; p <= total; p++) {
                stripper.setStartPage(p);
                stripper.setEndPage(p);
                String text = stripper.getText(pdDocument);
                pages.add(text != null ? text : "");
            }
            return pages;
        } catch (IOException | RuntimeException e) {
            return List.of();
        }
    }

    private record PdfEmbeddedMeta(String doi, String isbn, String title, String authors, Integer year, String subject) {
    }

    private PdfEmbeddedMeta extractPdfEmbeddedInfo(Path pdfPath) {
        if (pdfPath == null) {
            return new PdfEmbeddedMeta(null, null, null, null, null, null);
        }
        try (var randomAccessRead = new RandomAccessReadBufferedFile(pdfPath);
             PDDocument pdDocument = Loader.loadPDF(randomAccessRead)) {
            PDDocumentInformation info = pdDocument.getDocumentInformation();
            if (info == null) {
                return new PdfEmbeddedMeta(null, null, null, null, null, null);
            }

            String combinedInfoText = String.join(" ",
                    Optional.ofNullable(info.getCustomMetadataValue("doi")).orElse(""),
                    Optional.ofNullable(info.getCustomMetadataValue("DOI")).orElse(""),
                    Optional.ofNullable(info.getSubject()).orElse(""),
                    Optional.ofNullable(info.getKeywords()).orElse("")
            );

            String doi = extractDoi(combinedInfoText).orElse(null);
            String isbn = extractIsbn(combinedInfoText).orElse(null);
            String title = cleanEmbeddedField(info.getTitle());
            String author = cleanEmbeddedField(info.getAuthor());
            String subject = cleanEmbeddedField(info.getSubject());
            Integer year = null;
            Calendar cal = info.getCreationDate();
            if (cal != null) {
                int y = cal.get(Calendar.YEAR);
                if (y >= 1900 && y <= 2100) {
                    year = y;
                }
            }

            return new PdfEmbeddedMeta(doi, isbn, title, author, year, subject);
        } catch (Exception e) {
            return new PdfEmbeddedMeta(null, null, null, null, null, null);
        }
    }

    private String cleanEmbeddedField(String value) {
        if (value == null) return null;
        String trimmed = value.strip();
        if (trimmed.length() < 2) return null;
        String lower = trimmed.toLowerCase();
        if (lower.equals("untitled") || lower.startsWith("microsoft word") || lower.endsWith(".pdf") || lower.endsWith(".doc") || lower.endsWith(".docx")) {
            return null;
        }
        return trimmed;
    }
}

