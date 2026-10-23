package com.pdforever.dto;

import java.util.List;
import java.util.UUID;

public record SearchResultGroupDto(
        UUID docId,
        String title,
        String relPath,
        List<PageMatchDto> matches
) {
    public record PageMatchDto(
            int pageNumber,
            String snippetHtml,
            float score
    ) {
    }
}

