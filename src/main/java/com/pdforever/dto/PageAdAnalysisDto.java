package com.pdforever.dto;

import java.util.List;

public record PageAdAnalysisDto(
        int pageNumber,
        boolean isCover,
        boolean protectedPage,
        String protectionReason,
        List<String> matchedProtectedTerms,
        int wordCount,
        Boolean vlmIsAd,
        Double vlmConfidence,
        String vlmReason,
        String vlmError,
        boolean markedForRemoval
) {
}
