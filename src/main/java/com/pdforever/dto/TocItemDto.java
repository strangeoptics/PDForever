package com.pdforever.dto;

import java.util.List;

public record TocItemDto(
        String title,
        Integer pageNumber,
        String anchor,
        List<TocItemDto> children
) {
    public TocItemDto(String title, Integer pageNumber, List<TocItemDto> children) {
        this(title, pageNumber, null, children);
    }
}

