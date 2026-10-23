package com.pdforever.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateTagRequest(
        @NotBlank String name,
        String colorHex
) {
}

