package com.pdforever.service.rag.client;

import com.pdforever.dto.OllamaStatusDto;

import java.util.function.Consumer;

/**
 * Common abstraction for local and remote LLM providers (Ollama, OpenAI-compatible, LocalAI, vLLM, llama.cpp).
 */
public interface LlmClient {

    /**
     * Provider identifier (e.g. "ollama", "openai", "openai-compatible").
     */
    String getProviderType();

    /**
     * Checks if the backend is reachable and enumerates installed/available models.
     */
    OllamaStatusDto checkStatus(String baseUrl, String defaultModel, boolean enabled);

    /**
     * Sends prompt synchronously to generate an answer.
     */
    LlmResponse generate(LlmRequest request);

    /**
     * Streams generated tokens asynchronously via callbacks.
     */
    void streamGenerate(
            LlmRequest request,
            Consumer<String> tokenConsumer,
            Consumer<String> errorConsumer,
            Runnable doneCallback
    );
}

