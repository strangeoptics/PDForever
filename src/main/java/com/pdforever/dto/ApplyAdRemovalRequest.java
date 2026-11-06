package com.pdforever.dto;

import java.util.List;

public record ApplyAdRemovalRequest(
        List<Integer> pagesToRemove,
        String outputFileName
) {
}
