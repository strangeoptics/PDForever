package com.pdforever.dto;

import java.util.List;

public record OllamaStatusDto(
        boolean enabled,
        boolean available,
        String ollamaUrl,
        String currentModel,
        List<String> installedModels,
        String message
) {
}

