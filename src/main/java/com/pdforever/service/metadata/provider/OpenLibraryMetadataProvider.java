package com.pdforever.service.metadata.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pdforever.service.metadata.EnrichedMetadata;
import com.pdforever.service.metadata.MetadataProvider;
import com.pdforever.service.metadata.MetadataQuery;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class OpenLibraryMetadataProvider implements MetadataProvider {

    private static final Logger log = LoggerFactory.getLogger(OpenLibraryMetadataProvider.class);
    private static final String USER_AGENT = "PDForever/1.0 (In-Place Personal Library; mailto:pdforever@localhost)";
    private static final Pattern YEAR_PATTERN = Pattern.compile("\\b(18\\d{2}|19\\d{2}|20\\d{2})\\b");

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public OpenLibraryMetadataProvider(ObjectMapper objectMapper, HttpClient httpClient) {
        this.objectMapper = objectMapper;
        this.httpClient = httpClient;
    }

    @Override
    public String getName() {
        return "OPENLIBRARY";
    }

    @Override
    public int getOrder() {
        return 30;
    }

    @Override
    public boolean supports(MetadataQuery query) {
        return query != null && query.hasIsbn();
    }

    @Override
    public Optional<EnrichedMetadata> lookup(MetadataQuery query) {
        if (!supports(query)) {
            return Optional.empty();
        }
        return lookupByIsbn(query.isbn());
    }

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
}

