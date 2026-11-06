package com.pdforever.dto;

import java.util.List;
import java.util.UUID;

public record AdRemovalReportDto(
        UUID documentId,
        String documentFileName,
        String documentRelativePath,
        int totalPages,
        int protectedPagesCount,
        int vlmAdCount,
        int removedPagesCount,
        int keptPagesCount,
        int errorCount,
        boolean dryRun,
        String ollamaUrl,
        String model,
        double minConfidence,
        int dpi,
        List<Integer> pagesMarkedForRemoval,
        List<PageAdAnalysisDto> pages,
        UUID cleanedDocumentId,
        String cleanedFileName,
        String cleanedRelativePath,
        String logRelativePath
) {
    public AdRemovalReportDto(
            UUID documentId,
            String documentFileName,
            String documentRelativePath,
            int totalPages,
            int protectedPagesCount,
            int vlmAdCount,
            int removedPagesCount,
            int keptPagesCount,
            int errorCount,
            boolean dryRun,
            String ollamaUrl,
            String model,
            double minConfidence,
            int dpi,
            List<Integer> pagesMarkedForRemoval,
            List<PageAdAnalysisDto> pages,
            UUID cleanedDocumentId,
            String cleanedFileName,
            String cleanedRelativePath
    ) {
        this(
                documentId,
                documentFileName,
                documentRelativePath,
                totalPages,
                protectedPagesCount,
                vlmAdCount,
                removedPagesCount,
                keptPagesCount,
                errorCount,
                dryRun,
                ollamaUrl,
                model,
                minConfidence,
                dpi,
                pagesMarkedForRemoval,
                pages,
                cleanedDocumentId,
                cleanedFileName,
                cleanedRelativePath,
                null
        );
    }
}
