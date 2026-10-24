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
public class CrossRefMetadataProvider implements MetadataProvider {

    private static final Logger log = LoggerFactory.getLogger(CrossRefMetadataProvider.class);
    private static final String USER_AGENT = "PDForever/1.0 (In-Place Personal Library; mailto:pdforever@localhost)";

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final SemanticScholarMetadataProvider semanticScholarProvider;

    public CrossRefMetadataProvider(
            ObjectMapper objectMapper,
            HttpClient httpClient,
            SemanticScholarMetadataProvider semanticScholarProvider
    ) {
        this.objectMapper = objectMapper;
        this.httpClient = httpClient;
        this.semanticScholarProvider = semanticScholarProvider;
    }

    @Override
    public String getName() {
        return "CROSSREF";
    }

    @Override
    public int getOrder() {
        return 10;
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
        String doi = query.doi();
        Optional<EnrichedMetadata> crossRefOpt = fetchFromCrossRef(doi);
        if (crossRefOpt.isPresent()) {
            EnrichedMetadata cr = crossRefOpt.get();
            // If CrossRef lacks an abstract, supplement from Semantic Scholar if available
            if ((cr.abstractText() == null || cr.abstractText().isBlank()) && semanticScholarProvider != null) {
                Optional<EnrichedMetadata> s2Opt = semanticScholarProvider.fetchFromSemanticScholar(doi);
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
        return Optional.empty();
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

    private String cleanXmlTags(String input) {
        if (input == null) return null;
        String stripped = input.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").strip();
        return stripped.isEmpty() ? null : stripped;
    }
}

