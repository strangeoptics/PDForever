package com.pdforever.service.rag.client;

public record LlmRequest(
        String baseUrl,
        String model,
        String prompt,
        double temperature,
        double topP,
        String apiKey
) {
    public static LlmRequest of(String baseUrl, String model, String prompt) {
        return new LlmRequest(baseUrl, model, prompt, 0.1, 0.9, null);
    }
}

