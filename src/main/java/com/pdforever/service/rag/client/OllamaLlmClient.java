package com.pdforever.service.rag.client;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.pdforever.dto.OllamaStatusDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.function.Consumer;

@Component
public class OllamaLlmClient implements LlmClient {

    private static final Logger log = LoggerFactory.getLogger(OllamaLlmClient.class);

    public static final String DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
    public static final String DEFAULT_VLM_MODEL = "qwen2.5vl";

    public static final String VLM_AD_PROMPT =
            "Prüfe, ob diese vollständige Zeitschriftenseite eine ganzseitige Werbung " +
            "ist. Produktanzeigen und Markenwerbung gelten als Werbung; redaktionelle " +
            "Artikel und Inhaltsseiten nicht. Entscheide konservativ: Bei Zweifeln " +
            "setze is_ad auf false. Antworte gemäß dem JSON-Schema (confidence zwischen 0 und 1) " +
            "und formuliere reason kurz auf Deutsch.";

    public static final Map<String, Object> VLM_AD_JSON_SCHEMA = Map.of(
            "type", "object",
            "properties", Map.of(
                    "is_ad", Map.of("type", "boolean"),
                    "confidence", Map.of("type", "number"),
                    "reason", Map.of("type", "string")
            ),
            "required", List.of("is_ad", "confidence", "reason"),
            "additionalProperties", false
    );

    private static final Set<String> ALLOWED_VLM_FIELDS = Set.of("is_ad", "confidence", "reason");

    private final ObjectMapper objectMapper;
    private final ObjectMapper strictObjectMapper;
    private final HttpClient httpClient;

    public record VlmAdDecision(
            boolean isAd,
            double confidence,
            String reason
    ) {
    }

    public record VlmCallResult(
            VlmAdDecision decision,
            String error
    ) {
        public boolean isSuccess() {
            return decision != null && error == null;
        }

        public static VlmCallResult success(VlmAdDecision decision) {
            return new VlmCallResult(decision, null);
        }

        public static VlmCallResult failure(String error) {
            return new VlmCallResult(null, error);
        }
    }

    public OllamaLlmClient(ObjectMapper objectMapper, HttpClient httpClient) {
        this.objectMapper = objectMapper;
        this.strictObjectMapper = JsonMapper.builder()
                .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                .enable(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY)
                .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .build();
        this.httpClient = httpClient;
    }

    @Override
    public String getProviderType() {
        return "ollama";
    }

    @Override
    public OllamaStatusDto checkStatus(String baseUrl, String defaultModel, boolean enabled) {
        String url = sanitizeUrl(baseUrl);
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url + "/api/tags"))
                    .timeout(Duration.ofSeconds(3))
                    .GET()
                    .build();
            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() == 200 && res.body() != null) {
                JsonNode root = objectMapper.readTree(res.body());
                JsonNode modelsArr = root.path("models");
                List<String> installed = new ArrayList<>();
                if (modelsArr.isArray()) {
                    for (JsonNode m : modelsArr) {
                        String name = m.path("name").asText(null);
                        if (name != null) installed.add(name);
                    }
                }
                return new OllamaStatusDto(
                        enabled,
                        true,
                        url,
                        defaultModel,
                        installed,
                        "Ollama ist online und einsatzbereit (" + installed.size() + " Modelle installiert)."
                );
            }
        } catch (Exception e) {
            log.debug("Ollama status check failed on {}: {}", url, e.getMessage());
        }

        return new OllamaStatusDto(
                enabled,
                false,
                url,
                defaultModel,
                Collections.emptyList(),
                "Ollama ist offline (" + url + "). RAG ist optional. Starte Ollama z. B. mit 'ollama run " + defaultModel + "'."
        );
    }

    @Override
    public LlmResponse generate(LlmRequest request) {
        String url = sanitizeUrl(request.baseUrl());
        try {
            Map<String, Object> payload = Map.of(
                    "model", request.model(),
                    "prompt", request.prompt(),
                    "stream", false,
                    "options", Map.of(
                            "temperature", request.temperature(),
                            "top_p", request.topP()
                    )
            );

            HttpRequest req = HttpRequest.newBuilder(URI.create(url + "/api/generate"))
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(120))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload), StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() == 200 && res.body() != null) {
                JsonNode json = objectMapper.readTree(res.body());
                String answer = json.path("response").asText("");
                return LlmResponse.success(answer.strip());
            } else {
                return LlmResponse.failure("Ollama API-Fehler (HTTP " + res.statusCode() + "): " + res.body());
            }
        } catch (Exception e) {
            log.warn("Ollama generate request failed: {}", e.getMessage());
            return LlmResponse.failure("Ollama ist nicht erreichbar (" + url + "). Starte Ollama z. B. mit 'ollama run " + request.model() + "'.");
        }
    }

    @Override
    public void streamGenerate(
            LlmRequest request,
            Consumer<String> tokenConsumer,
            Consumer<String> errorConsumer,
            Runnable doneCallback
    ) {
        String url = sanitizeUrl(request.baseUrl());
        try {
            Map<String, Object> payload = Map.of(
                    "model", request.model(),
                    "prompt", request.prompt(),
                    "stream", true,
                    "options", Map.of(
                            "temperature", request.temperature(),
                            "top_p", request.topP()
                    )
            );

            HttpRequest req = HttpRequest.newBuilder(URI.create(url + "/api/generate"))
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(120))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload), StandardCharsets.UTF_8))
                    .build();

            HttpResponse<java.io.InputStream> res = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
            if (res.statusCode() != 200) {
                errorConsumer.accept("Ollama HTTP " + res.statusCode());
                return;
            }

            try (BufferedReader reader = new BufferedReader(new InputStreamReader(res.body(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.isBlank()) continue;
                    JsonNode node = objectMapper.readTree(line);
                    String token = node.path("response").asText("");
                    if (!token.isEmpty()) {
                        tokenConsumer.accept(token);
                    }
                    if (node.path("done").asBoolean(false)) {
                        break;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Ollama streaming error: {}", e.getMessage());
            errorConsumer.accept("Ollama nicht erreichbar (" + url + "). Starte Ollama z. B. mit 'ollama run " + request.model() + "'.");
        } finally {
            doneCallback.run();
        }
    }

    /**
     * Sends a base64-encoded PNG image of a full magazine page to Ollama VLM (/api/chat, with /api/generate fallback)
     * with temperature=0, seed=0, and structured JSON schema format, and strictly validates the response.
     * The model name is passed verbatim without rewriting.
     */
    public VlmCallResult classifyPageImageWithVlm(String baseUrl, String model, byte[] pngBytes) {
        if (pngBytes == null || pngBytes.length == 0) {
            return VlmCallResult.failure("Leere Bilddaten beim Rendern der PDF-Seite.");
        }
        if (model == null || model.isBlank()) {
            return VlmCallResult.failure("Kein Ollama-Modellname angegeben.");
        }

        String url = sanitizeUrl(baseUrl);
        String base64Image = Base64.getEncoder().encodeToString(pngBytes);

        try {
            Map<String, Object> chatPayload = new LinkedHashMap<>();
            chatPayload.put("model", model);
            chatPayload.put("messages", List.of(
                    Map.of(
                            "role", "user",
                            "content", VLM_AD_PROMPT,
                            "images", List.of(base64Image)
                    )
            ));
            chatPayload.put("stream", false);
            chatPayload.put("format", VLM_AD_JSON_SCHEMA);
            chatPayload.put("options", Map.of(
                    "temperature", 0,
                    "seed", 0
            ));

            HttpRequest chatReq = HttpRequest.newBuilder(URI.create(url + "/api/chat"))
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(180))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(chatPayload), StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> res = httpClient.send(chatReq, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));

            if (res.statusCode() == 404) {
                Map<String, Object> genPayload = new LinkedHashMap<>();
                genPayload.put("model", model);
                genPayload.put("prompt", VLM_AD_PROMPT);
                genPayload.put("images", List.of(base64Image));
                genPayload.put("stream", false);
                genPayload.put("format", VLM_AD_JSON_SCHEMA);
                genPayload.put("options", Map.of(
                        "temperature", 0,
                        "seed", 0
                ));

                HttpRequest genReq = HttpRequest.newBuilder(URI.create(url + "/api/generate"))
                        .header("Content-Type", "application/json")
                        .timeout(Duration.ofSeconds(180))
                        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(genPayload), StandardCharsets.UTF_8))
                        .build();

                res = httpClient.send(genReq, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            }

            if (res.statusCode() != 200 || res.body() == null) {
                return VlmCallResult.failure("Ollama API-Fehler (HTTP " + res.statusCode() + "): " + (res.body() != null ? res.body() : ""));
            }

            JsonNode root = objectMapper.readTree(res.body());
            if (root.has("error") && !root.get("error").isNull()) {
                return VlmCallResult.failure("Ollama Fehler: " + root.get("error").asText());
            }

            String rawContent = null;
            if (root.has("message") && root.get("message").isObject() && root.get("message").has("content")) {
                rawContent = root.get("message").get("content").asText(null);
            } else if (root.has("response")) {
                rawContent = root.get("response").asText(null);
            }

            if (rawContent == null) {
                return VlmCallResult.failure("Ollama-Antwort enthält kein 'message.content' oder 'response'-Feld.");
            }

            VlmAdDecision decision = validateAndParseVlmJson(rawContent);
            return VlmCallResult.success(decision);
        } catch (IllegalArgumentException validationEx) {
            return VlmCallResult.failure("Ungültige VLM-Antwort: " + validationEx.getMessage());
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return VlmCallResult.failure("VLM-Anfrage abgebrochen.");
        } catch (Exception e) {
            log.warn("Ollama VLM request failed on {} (model={}): {}", url, model, e.getMessage());
            return VlmCallResult.failure("Ollama VLM nicht erreichbar (" + url + ", Modell: " + model + "): " + e.getMessage());
        }
    }

    /**
     * Strictly validates the VLM JSON output against the required schema:
     * {
     *   "is_ad": boolean,
     *   "confidence": number (finite, 0..1),
     *   "reason": string (non-empty after stripping whitespace)
     * }
     * Rejects unexpected fields, missing fields, duplicate keys, trailing tokens, and wrong types.
     */
    public VlmAdDecision validateAndParseVlmJson(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            throw new IllegalArgumentException("Antwort ist leer.");
        }

        JsonNode node;
        try (JsonParser parser = strictObjectMapper.createParser(rawJson)) {
            node = strictObjectMapper.readTree(parser);
            if (parser.nextToken() != null) {
                throw new IllegalArgumentException("Unerwartete Zeichen nach dem JSON-Objekt.");
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("Kein gültiges JSON: " + e.getMessage(), e);
        }

        if (node == null || !node.isObject()) {
            throw new IllegalArgumentException("JSON-Wurzel muss ein Objekt sein.");
        }

        Set<String> presentFields = new HashSet<>();
        Iterator<String> fieldNames = node.fieldNames();
        while (fieldNames.hasNext()) {
            String field = fieldNames.next();
            if (!ALLOWED_VLM_FIELDS.contains(field)) {
                throw new IllegalArgumentException("Unerwartetes Feld '" + field + "' in VLM-Antwort.");
            }
            presentFields.add(field);
        }

        if (!presentFields.containsAll(ALLOWED_VLM_FIELDS) || presentFields.size() != ALLOWED_VLM_FIELDS.size()) {
            throw new IllegalArgumentException("Pflichtfelder fehlen (erwartet: is_ad, confidence, reason).");
        }

        JsonNode isAdNode = node.get("is_ad");
        if (isAdNode == null || !isAdNode.isBoolean()) {
            throw new IllegalArgumentException("'is_ad' muss ein Boolean sein.");
        }
        boolean isAd = isAdNode.booleanValue();

        JsonNode confidenceNode = node.get("confidence");
        if (confidenceNode == null || !confidenceNode.isNumber()) {
            throw new IllegalArgumentException("'confidence' muss eine Zahl sein.");
        }
        String rawNumberText = confidenceNode.asText();
        double confidence = confidenceNode.doubleValue();
        if (!Double.isFinite(confidence)
                || "Infinity".equalsIgnoreCase(rawNumberText)
                || "-Infinity".equalsIgnoreCase(rawNumberText)
                || "NaN".equalsIgnoreCase(rawNumberText)
                || confidence < 0.0
                || confidence > 1.0) {
            throw new IllegalArgumentException("'confidence' muss eine endliche Zahl zwischen 0 und 1 sein (erhalten: " + rawNumberText + ").");
        }

        JsonNode reasonNode = node.get("reason");
        if (reasonNode == null || !reasonNode.isTextual()) {
            throw new IllegalArgumentException("'reason' muss ein String sein.");
        }
        String reason = reasonNode.textValue();
        if (reason == null || reason.strip().isEmpty() || reason.trim().isEmpty()) {
            throw new IllegalArgumentException("'reason' darf nach Entfernen von Leerzeichen nicht leer sein.");
        }

        return new VlmAdDecision(isAd, confidence, reason.strip());
    }

    public String sanitizeUrl(String url) {
        if (url == null || url.isBlank()) {
            return DEFAULT_OLLAMA_URL;
        }
        return url.strip().replaceAll("/+$", "");
    }
}

