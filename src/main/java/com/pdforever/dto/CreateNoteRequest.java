package com.pdforever.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record CreateNoteRequest(
        @NotNull UUID documentId,
        @NotNull @Min(1) Integer pageNumber,
        String selectedText,
        @NotNull String noteMarkdown,
        @NotNull BoundingBoxDto boundingBox
) {
}

