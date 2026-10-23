package com.pdforever.controller;

import com.pdforever.dto.DocumentFilterCriteria;
import com.pdforever.dto.SearchResultGroupDto;
import com.pdforever.service.SearchService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/search")
public class SearchController {

    private final SearchService searchService;

    public SearchController(SearchService searchService) {
        this.searchService = searchService;
    }

    @GetMapping
    public List<SearchResultGroupDto> search(
            @RequestParam(name = "q", defaultValue = "") String query,
            @RequestParam(required = false) String path,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Integer minPages,
            @RequestParam(required = false) Integer maxPages,
            @RequestParam(required = false) Boolean hasNotes,
            @RequestParam(required = false) String noteQuery,
            @RequestParam(required = false) Instant modifiedAfter,
            @RequestParam(required = false) Instant modifiedBefore,
            @RequestParam(required = false) Integer yearFrom,
            @RequestParam(required = false) Integer yearTo,
            @RequestParam(required = false) Boolean hasMetadata
    ) {
        DocumentFilterCriteria criteria = new DocumentFilterCriteria(
                path,
                tag,
                status,
                minPages,
                maxPages,
                hasNotes,
                noteQuery,
                modifiedAfter,
                modifiedBefore,
                yearFrom,
                yearTo,
                hasMetadata,
                "fileName",
                "asc"
        );
        return searchService.search(query, criteria);
    }
}

