package com.pdforever.service.rag;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pdforever.config.LibraryProperties;
import com.pdforever.dto.OllamaStatusDto;
import com.pdforever.dto.RagPassageDto;
import com.pdforever.dto.RagQueryRequest;
import com.pdforever.dto.RagResponseDto;
import com.pdforever.service.FileNameCleaner;
import com.pdforever.service.OllamaRagService;
import com.pdforever.service.rag.client.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

class LlmClientArchitectureTest {

    private ObjectMapper objectMapper;
    private OllamaLlmClient ollamaClient;
    private OpenAiCompatibleLlmClient openAiClient;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        ollamaClient = new OllamaLlmClient(objectMapper, null);
        openAiClient = new OpenAiCompatibleLlmClient(objectMapper, null);
    }

    @Test
    void testProviderTypes() {
        assertThat(ollamaClient.getProviderType()).isEqualTo("ollama");
        assertThat(openAiClient.getProviderType()).isEqualTo("openai");
    }

    @Test
    void testOfflineStatusGracefulFallback() {
        OllamaStatusDto ollamaStatus = ollamaClient.checkStatus("http://invalid-host-99999", "qwen2.5:14b", true);
        assertThat(ollamaStatus.available()).isFalse();
        assertThat(ollamaStatus.installedModels()).isEmpty();
        assertThat(ollamaStatus.message()).contains("Ollama ist offline");

        OllamaStatusDto openAiStatus = openAiClient.checkStatus("http://invalid-host-99999", "llama-3-8b", true);
        assertThat(openAiStatus.available()).isFalse();
        assertThat(openAiStatus.installedModels()).isEmpty();
        assertThat(openAiStatus.message()).contains("OpenAI-kompatibler Endpunkt ist offline");
    }

    @Test
    void testOllamaRagServiceResolvesConfiguredProvider() {
        LibraryProperties ollamaProps = new LibraryProperties(
                Path.of("./storage"), Path.of("./lucene"), Path.of("./covers"), 500L, false,
                List.of(), List.of(),
                new LibraryProperties.RagProperties(true, "http://localhost:11434", "qwen2.5:14b", 6, "ollama", null)
        );

        OllamaRagService ollamaRagService = new OllamaRagService(
                ollamaProps, null, null, null, new FileNameCleaner(ollamaProps),
                List.of(ollamaClient, openAiClient)
        );

        assertThat(ollamaRagService.resolveLlmClient().getProviderType()).isEqualTo("ollama");

        LibraryProperties openAiProps = new LibraryProperties(
                Path.of("./storage"), Path.of("./lucene"), Path.of("./covers"), 500L, false,
                List.of(), List.of(),
                new LibraryProperties.RagProperties(true, "http://localhost:8000", "mistral-7b", 6, "vllm", null)
        );

        OllamaRagService openAiRagService = new OllamaRagService(
                openAiProps, null, null, null, new FileNameCleaner(openAiProps),
                List.of(ollamaClient, openAiClient)
        );

        assertThat(openAiRagService.resolveLlmClient().getProviderType()).isEqualTo("openai");
    }

    @Test
    void testCustomLlmClientPluggabilityInRagService() {
        AtomicReference<String> generatedPrompt = new AtomicReference<>();
        AtomicBoolean streamDone = new AtomicBoolean(false);

        LlmClient mockLlm = new LlmClient() {
            @Override
            public String getProviderType() {
                return "mock-provider";
            }

            @Override
            public OllamaStatusDto checkStatus(String baseUrl, String defaultModel, boolean enabled) {
                return new OllamaStatusDto(enabled, true, baseUrl, defaultModel, List.of("mock-model"), "Online");
            }

            @Override
            public LlmResponse generate(LlmRequest request) {
                generatedPrompt.set(request.prompt());
                return LlmResponse.success("Antwort auf Basis von [S. 1].");
            }

            @Override
            public void streamGenerate(
                    LlmRequest request,
                    Consumer<String> tokenConsumer,
                    Consumer<String> errorConsumer,
                    Runnable doneCallback
            ) {
                tokenConsumer.accept("Token1 ");
                tokenConsumer.accept("Token2 [S. 1].");
                streamDone.set(true);
                doneCallback.run();
            }
        };

        LibraryProperties props = new LibraryProperties(
                Path.of("./storage"), Path.of("./lucene"), Path.of("./covers"), 500L, false,
                List.of(), List.of(),
                new LibraryProperties.RagProperties(true, "http://mock-llm", "mock-model", 6, "mock-provider", "secret")
        );

        // Subclass OllamaRagService to override retrievePassages without requiring Lucene index
        OllamaRagService ragService = new OllamaRagService(
                props, null, null, null, new FileNameCleaner(props), List.of(mockLlm)
        ) {
            @Override
            public List<RagPassageDto> retrievePassages(String query, UUID docId, com.pdforever.dto.DocumentFilterCriteria criteria, int max) {
                return List.of(new RagPassageDto(
                        UUID.randomUUID(), "Test Document", "test.pdf", 1, "Wichtiger Textauszug aus Seite 1.", 1.5f
                ));
            }
        };

        // Test synchronous ask()
        RagResponseDto askResponse = ragService.ask(new RagQueryRequest("Was steht auf Seite 1?", null, null, "mock-model"));
        assertThat(askResponse.ollamaAvailable()).isTrue();
        assertThat(askResponse.answer()).isEqualTo("Antwort auf Basis von [S. 1].");
        assertThat(askResponse.passages()).hasSize(1);
        assertThat(generatedPrompt.get()).contains("Wichtiger Textauszug aus Seite 1.");

        // Test streaming ask()
        List<String> streamedTokens = new ArrayList<>();
        ragService.streamAsk(
                new RagQueryRequest("Was steht auf Seite 1?", null, null, "mock-model"),
                passages -> assertThat(passages).hasSize(1),
                streamedTokens::add,
                error -> {},
                () -> {}
        );

        assertThat(streamDone.get()).isTrue();
        assertThat(streamedTokens).containsExactly("Token1 ", "Token2 [S. 1].");
    }
}
