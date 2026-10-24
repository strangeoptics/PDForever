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
public class OpenAiCompatibleLlmClient implements LlmClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAiCompatibleLlmClient.class);

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public OpenAiCompatibleLlmClient(ObjectMapper objectMapper, HttpClient httpClient) {
        this.objectMapper = objectMapper;
        this.httpClient = httpClient;
    }

    @Override
    public String getProviderType() {
        return "openai";
    }

    @Override
    public OllamaStatusDto checkStatus(String baseUrl, String defaultModel, boolean enabled) {
        String url = sanitizeUrl(baseUrl);
        try {
            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder(URI.create(url + "/v1/models"))
                    .timeout(Duration.ofSeconds(3))
                    .header("Accept", "application/json")
                    .GET();

            HttpResponse<String> res = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() == 200 && res.body() != null) {
                JsonNode root = objectMapper.readTree(res.body());
                JsonNode dataArr = root.path("data");
                List<String> models = new ArrayList<>();
                if (dataArr.isArray()) {
                    for (JsonNode m : dataArr) {
                        String id = m.path("id").asText(null);
                        if (id != null) models.add(id);
                    }
                }
                return new OllamaStatusDto(
                        enabled,
                        true,
                        url,
                        defaultModel,
                        models,
                        "OpenAI-kompatibler Endpunkt ist online (" + models.size() + " Modelle gefunden)."
                );
            }
        } catch (Exception e) {
            log.debug("OpenAI-compatible status check failed on {}: {}", url, e.getMessage());
        }

        return new OllamaStatusDto(
                enabled,
                false,
                url,
                defaultModel,
                Collections.emptyList(),
                "OpenAI-kompatibler Endpunkt ist offline (" + url + ")."
        );
    }

    @Override
    public LlmResponse generate(LlmRequest request) {
        String url = sanitizeUrl(request.baseUrl());
        try {
            Map<String, Object> payload = Map.of(
                    "model", request.model(),
                    "messages", List.of(
                            Map.of("role", "user", "content", request.prompt())
                    ),
                    "temperature", request.temperature(),
                    "top_p", request.topP(),
                    "stream", false
            );

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder(URI.create(url + "/v1/chat/completions"))
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(120))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload), StandardCharsets.UTF_8));

            if (request.apiKey() != null && !request.apiKey().isBlank()) {
                reqBuilder.header("Authorization", "Bearer " + request.apiKey().strip());
            }

            HttpResponse<String> res = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() == 200 && res.body() != null) {
                JsonNode json = objectMapper.readTree(res.body());
                JsonNode choices = json.path("choices");
                if (choices.isArray() && !choices.isEmpty()) {
                    String answer = choices.get(0).path("message").path("content").asText("");
                    return LlmResponse.success(answer.strip());
                }
                return LlmResponse.failure("Keine Antwortauswahl im Response: " + res.body());
            } else {
                return LlmResponse.failure("OpenAI API-Fehler (HTTP " + res.statusCode() + "): " + res.body());
            }
        } catch (Exception e) {
            log.warn("OpenAI generate request failed: {}", e.getMessage());
            return LlmResponse.failure("OpenAI-kompatibler Server nicht erreichbar (" + url + "): " + e.getMessage());
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
                    "messages", List.of(
                            Map.of("role", "user", "content", request.prompt())
                    ),
                    "temperature", request.temperature(),
                    "top_p", request.topP(),
                    "stream", true
            );

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder(URI.create(url + "/v1/chat/completions"))
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream")
                    .timeout(Duration.ofSeconds(120))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload), StandardCharsets.UTF_8));

            if (request.apiKey() != null && !request.apiKey().isBlank()) {
                reqBuilder.header("Authorization", "Bearer " + request.apiKey().strip());
            }

            HttpResponse<java.io.InputStream> res = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofInputStream());
            if (res.statusCode() != 200) {
                errorConsumer.accept("OpenAI HTTP " + res.statusCode());
                return;
            }

            try (BufferedReader reader = new BufferedReader(new InputStreamReader(res.body(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.isBlank() || line.startsWith(":")) continue;
                    if (line.startsWith("data:")) {
                        String data = line.substring(5).strip();
                        if ("[DONE]".equals(data)) {
                            break;
                        }
                        try {
                            JsonNode node = objectMapper.readTree(data);
                            JsonNode choices = node.path("choices");
                            if (choices.isArray() && !choices.isEmpty()) {
                                String token = choices.get(0).path("delta").path("content").asText("");
                                if (!token.isEmpty()) {
                                    tokenConsumer.accept(token);
                                }
                            }
                        } catch (Exception parseEx) {
                            log.debug("Skipping unparseable SSE line: {}", line);
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("OpenAI streaming error: {}", e.getMessage());
            errorConsumer.accept("OpenAI-kompatibler Endpunkt nicht erreichbar (" + url + "): " + e.getMessage());
        } finally {
            doneCallback.run();
        }
    }

    private String sanitizeUrl(String url) {
        if (url == null || url.isBlank()) {
            return "http://localhost:8000";
        }
        return url.replaceAll("/+$", "");
    }
}

