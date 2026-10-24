package com.pdforever.dto;

import java.util.List;
import java.util.UUID;

public record SearchResultGroupDto(
        UUID docId,
        String title,
        String relPath,
        List<PageMatchDto> matches,
        String format
) {
    public SearchResultGroupDto(UUID docId, String title, String relPath, List<PageMatchDto> matches) {
        this(docId, title, relPath, matches, relPath != null && relPath.toLowerCase(java.util.Locale.ROOT).endsWith(".epub") ? "EPUB" : "PDF");
    }

    public record PageMatchDto(
            int pageNumber,
            String snippetHtml,
            float score
    ) {
    }
}

