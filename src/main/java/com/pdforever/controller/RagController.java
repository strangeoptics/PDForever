package com.pdforever.controller;

import com.pdforever.dto.OllamaStatusDto;
import com.pdforever.dto.RagPassageDto;
import com.pdforever.dto.RagQueryRequest;
import com.pdforever.dto.RagResponseDto;
import com.pdforever.service.OllamaRagService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/rag")
public class RagController {

    private static final Logger log = LoggerFactory.getLogger(RagController.class);

    private final OllamaRagService ollamaRagService;

    public RagController(OllamaRagService ollamaRagService) {
        this.ollamaRagService = ollamaRagService;
    }

    @GetMapping("/status")
    public OllamaStatusDto getStatus(@RequestParam(required = false) String ollamaUrl) {
        return ollamaRagService.checkOllamaStatus(ollamaUrl);
    }

    @PostMapping("/ask")
    public RagResponseDto ask(@RequestBody RagQueryRequest request) {
        return ollamaRagService.ask(request);
    }

    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@RequestBody RagQueryRequest request) {
        // 2 minute timeout for LLM generation
        SseEmitter emitter = new SseEmitter(120_000L);

        Thread.ofVirtual().name("rag-stream-", 0).start(() -> {
            try {
                ollamaRagService.streamAsk(
                        request,
                        passages -> {
                            try {
                                emitter.send(SseEmitter.event().name("passages").data(passages));
                            } catch (IOException e) {
                                log.debug("Failed sending passages SSE: {}", e.getMessage());
                            }
                        },
                        token -> {
                            try {
                                emitter.send(SseEmitter.event().name("token").data(Map.of("token", token)));
                            } catch (IOException e) {
                                log.debug("Failed sending token SSE: {}", e.getMessage());
                            }
                        },
                        error -> {
                            try {
                                emitter.send(SseEmitter.event().name("error").data(Map.of("error", error)));
                            } catch (IOException e) {
                                log.debug("Failed sending error SSE: {}", e.getMessage());
                            }
                        },
                        () -> {
                            try {
                                emitter.send(SseEmitter.event().name("done").data(Map.of("done", true)));
                                emitter.complete();
                            } catch (Exception ignored) {
                                emitter.complete();
                            }
                        }
                );
            } catch (Exception e) {
                log.error("Unhandled error in RAG SSE stream: {}", e.getMessage(), e);
                try {
                    emitter.send(SseEmitter.event().name("error").data(e.getMessage()));
                } catch (IOException ignored) {
                }
                emitter.completeWithError(e);
            }
        });

        return emitter;
    }
}

