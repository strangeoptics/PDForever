package com.pdforever.dto;

public record AdRemovalRequest(
        String ollamaUrl,
        String model,
        Double minConfidence,
        Integer dpi,
        Boolean dryRun,
        String outputFileName,
        Boolean includeReason
) {
    public AdRemovalRequest(
            String ollamaUrl,
            String model,
            Double minConfidence,
            Integer dpi,
            Boolean dryRun,
            String outputFileName
    ) {
        this(ollamaUrl, model, minConfidence, dpi, dryRun, outputFileName, true);
    }
}
