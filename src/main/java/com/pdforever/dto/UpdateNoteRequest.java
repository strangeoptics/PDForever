package com.pdforever.dto;

import jakarta.validation.constraints.NotNull;

public record UpdateNoteRequest(
        String selectedText,
        @NotNull String noteMarkdown,
        BoundingBoxDto boundingBox
) {
}

