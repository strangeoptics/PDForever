package com.pdforever.controller;

import com.pdforever.dto.*;
import com.pdforever.service.ReadingNoteService;
import com.pdforever.service.TagService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class NoteAndTagController {

    private final TagService tagService;
    private final ReadingNoteService noteService;

    public NoteAndTagController(TagService tagService, ReadingNoteService noteService) {
        this.tagService = tagService;
        this.noteService = noteService;
    }

    // --- Tags ---

    @GetMapping("/tags")
    public List<TagDto> getAllTags() {
        return tagService.getAllTags();
    }

    @PostMapping("/tags")
    @ResponseStatus(HttpStatus.CREATED)
    public TagDto createTag(@Valid @RequestBody CreateTagRequest request) {
        return tagService.createTag(request);
    }

    @DeleteMapping("/tags/{tagId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteTag(@PathVariable Long tagId) {
        tagService.deleteTag(tagId);
    }

    @PostMapping("/documents/{id}/tags/{tagId}")
    public DocumentDto attachTagToDocument(@PathVariable UUID id, @PathVariable Long tagId) {
        return tagService.addTagToDocument(id, tagId);
    }

    @DeleteMapping("/documents/{id}/tags/{tagId}")
    public DocumentDto detachTagFromDocument(@PathVariable UUID id, @PathVariable Long tagId) {
        return tagService.removeTagFromDocument(id, tagId);
    }

    // --- Reading Notes (Lesezettel) ---

    @GetMapping("/documents/{id}/notes")
    public List<ReadingNoteDto> getDocumentNotes(@PathVariable UUID id) {
        return noteService.getNotesForDocument(id);
    }

    @PostMapping("/notes")
    @ResponseStatus(HttpStatus.CREATED)
    public ReadingNoteDto createNote(@Valid @RequestBody CreateNoteRequest request) {
        return noteService.createNote(request);
    }

    @PutMapping("/notes/{id}")
    public ReadingNoteDto updateNote(@PathVariable UUID id, @Valid @RequestBody UpdateNoteRequest request) {
        return noteService.updateNote(id, request);
    }

    @DeleteMapping("/notes/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteNote(@PathVariable UUID id) {
        noteService.deleteNote(id);
    }

    @GetMapping("/notes")
    public List<ReadingNoteDto> searchNotes(@RequestParam(name = "q", required = false, defaultValue = "") String query) {
        return noteService.searchNotes(query);
    }
}

