package com.pdforever.service.rag.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public OllamaLlmClient(ObjectMapper objectMapper, HttpClient httpClient) {
        this.objectMapper = objectMapper;
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

    private String sanitizeUrl(String url) {
        if (url == null || url.isBlank()) {
            return "http://localhost:11434";
        }
        return url.replaceAll("/+$", "");
    }
}

