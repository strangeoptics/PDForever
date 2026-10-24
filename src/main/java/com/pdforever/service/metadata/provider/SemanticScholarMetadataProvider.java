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

@Component
public class SemanticScholarMetadataProvider implements MetadataProvider {

    private static final Logger log = LoggerFactory.getLogger(SemanticScholarMetadataProvider.class);
    private static final String USER_AGENT = "PDForever/1.0 (In-Place Personal Library; mailto:pdforever@localhost)";

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public SemanticScholarMetadataProvider(ObjectMapper objectMapper, HttpClient httpClient) {
        this.objectMapper = objectMapper;
        this.httpClient = httpClient;
    }

    @Override
    public String getName() {
        return "SEMANTIC_SCHOLAR";
    }

    @Override
    public int getOrder() {
        return 20;
    }

    @Override
    public boolean supports(MetadataQuery query) {
        return query != null && query.hasDoi();
    }

    @Override
    public Optional<EnrichedMetadata> lookup(MetadataQuery query) {
        if (!supports(query)) {
            return Optional.empty();
        }
        return fetchFromSemanticScholar(query.doi());
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
}

