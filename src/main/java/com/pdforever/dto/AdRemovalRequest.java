package com.pdforever.dto;

public record AdRemovalRequest(
        String ollamaUrl,
        String model,
        Double minConfidence,
        Integer dpi,
        Boolean dryRun,
        String outputFileName
) {
}
