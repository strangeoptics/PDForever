package com.pdforever.dto;

import java.util.List;

public record RagResponseDto(
        String answer,
        List<RagPassageDto> passages,
        String model,
        boolean ollamaAvailable,
        String errorMessage
) {
}

