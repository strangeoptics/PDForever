package com.pdforever.service.rag.client;

public record LlmResponse(
        String text,
        boolean success,
        String errorMessage
) {
    public static LlmResponse success(String text) {
        return new LlmResponse(text, true, null);
    }

    public static LlmResponse failure(String errorMessage) {
        return new LlmResponse(null, false, errorMessage);
    }
}

