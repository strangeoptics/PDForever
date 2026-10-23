package com.pdforever.dto;

public record MetadataEnrichmentReportDto(
        int scanned,
        int identifiersDetected,
        int enriched
) {
}

