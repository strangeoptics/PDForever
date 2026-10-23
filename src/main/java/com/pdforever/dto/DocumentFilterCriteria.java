package com.pdforever.dto;

import java.time.Instant;

public record DocumentFilterCriteria(
        String path,
        String tag,
        String status,
        Integer minPages,
        Integer maxPages,
        Boolean hasNotes,
        String noteQuery,
        Instant modifiedAfter,
        Instant modifiedBefore,
        Integer yearFrom,
        Integer yearTo,
        Boolean hasMetadata,
        String sortBy,
        String sortDir
) {
    public static DocumentFilterCriteria empty() {
        return new DocumentFilterCriteria(
                null, null, null, null, null, null, null, null, null, null, null, null, "fileName", "asc"
        );
    }

    public boolean hasAnyFilter() {
        return (path != null && !path.isBlank())
                || (tag != null && !tag.isBlank())
                || (status != null && !status.isBlank())
                || minPages != null
                || maxPages != null
                || hasNotes != null
                || (noteQuery != null && !noteQuery.isBlank())
                || modifiedAfter != null
                || modifiedBefore != null
                || yearFrom != null
                || yearTo != null
                || hasMetadata != null;
    }
}

