package com.pdforever.dto;

import java.util.List;

public record TocItemDto(
        String title,
        Integer pageNumber,
        List<TocItemDto> children
) {
}

