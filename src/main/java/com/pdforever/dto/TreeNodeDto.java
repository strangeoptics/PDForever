package com.pdforever.dto;

import java.util.List;
import java.util.UUID;

public record TreeNodeDto(
        String name,
        String path,
        String type,
        UUID documentId,
        Integer pageCount,
        List<TreeNodeDto> children
) {
}

