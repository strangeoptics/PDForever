package com.pdforever.dto;

import java.util.UUID;

public record RagQueryRequest(
        String query,
        UUID documentId,
        DocumentFilterCriteria criteria,
        String model
) {
}

