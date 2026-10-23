package com.pdforever.controller;

import com.pdforever.dto.SearchResultGroupDto;
import com.pdforever.service.SearchService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/search")
public class SearchController {

    private final SearchService searchService;

    public SearchController(SearchService searchService) {
        this.searchService = searchService;
    }

    @GetMapping
    public List<SearchResultGroupDto> search(@RequestParam(name = "q", defaultValue = "") String query) {
        return searchService.search(query);
    }
}

