package com.pdforever.controller;

import com.pdforever.dto.*;
import com.pdforever.service.LibraryManagementService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class NoteAndTagController {

    private final LibraryManagementService libraryService;

    public NoteAndTagController(LibraryManagementService libraryService) {
        this.libraryService = libraryService;
    }

    // --- Tags ---

    @GetMapping("/tags")
    public List<TagDto> getAllTags() {
        return libraryService.getAllTags();
    }

    @PostMapping("/tags")
    @ResponseStatus(HttpStatus.CREATED)
    public TagDto createTag(@Valid @RequestBody CreateTagRequest request) {
        return libraryService.createTag(request);
    }

    @DeleteMapping("/tags/{tagId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteTag(@PathVariable Long tagId) {
        libraryService.deleteTag(tagId);
    }

    @PostMapping("/documents/{id}/tags/{tagId}")
    public DocumentDto attachTagToDocument(@PathVariable UUID id, @PathVariable Long tagId) {
        return libraryService.addTagToDocument(id, tagId);
    }

    @DeleteMapping("/documents/{id}/tags/{tagId}")
    public DocumentDto detachTagFromDocument(@PathVariable UUID id, @PathVariable Long tagId) {
        return libraryService.removeTagFromDocument(id, tagId);
    }

    // --- Reading Notes (Lesezettel) ---

    @GetMapping("/documents/{id}/notes")
    public List<ReadingNoteDto> getDocumentNotes(@PathVariable UUID id) {
        return libraryService.getNotesForDocument(id);
    }

    @PostMapping("/notes")
    @ResponseStatus(HttpStatus.CREATED)
    public ReadingNoteDto createNote(@Valid @RequestBody CreateNoteRequest request) {
        return libraryService.createNote(request);
    }

    @PutMapping("/notes/{id}")
    public ReadingNoteDto updateNote(@PathVariable UUID id, @Valid @RequestBody UpdateNoteRequest request) {
        return libraryService.updateNote(id, request);
    }

    @DeleteMapping("/notes/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteNote(@PathVariable UUID id) {
        libraryService.deleteNote(id);
    }

    @GetMapping("/notes")
    public List<ReadingNoteDto> searchNotes(@RequestParam(name = "q", required = false, defaultValue = "") String query) {
        return libraryService.searchNotes(query);
    }
}

