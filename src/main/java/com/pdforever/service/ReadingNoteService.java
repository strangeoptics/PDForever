package com.pdforever.service;

import com.pdforever.domain.Document;
import com.pdforever.domain.ReadingNote;
import com.pdforever.dto.CreateNoteRequest;
import com.pdforever.dto.ReadingNoteDto;
import com.pdforever.dto.UpdateNoteRequest;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.repository.ReadingNoteRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@Service
public class ReadingNoteService {

    private final ReadingNoteRepository noteRepository;
    private final DocumentRepository documentRepository;
    private final DocumentDtoMapper mapper;

    public ReadingNoteService(
            ReadingNoteRepository noteRepository,
            DocumentRepository documentRepository,
            DocumentDtoMapper mapper
    ) {
        this.noteRepository = noteRepository;
        this.documentRepository = documentRepository;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public List<ReadingNoteDto> getNotesForDocument(UUID documentId) {
        findActiveDocumentOrThrow(documentId);
        return noteRepository.findAllByDocumentIdOrderByPageNumberAscCreatedAtAsc(documentId).stream()
                .map(mapper::toReadingNoteDto)
                .toList();
    }

    @Transactional
    public ReadingNoteDto createNote(CreateNoteRequest request) {
        Document doc = findActiveDocumentOrThrow(request.documentId());
        ReadingNote note = new ReadingNote();
        note.setDocument(doc);
        note.setPageNumber(request.pageNumber());
        note.setSelectedText(request.selectedText() != null ? request.selectedText() : "");
        note.setNoteMarkdown(request.noteMarkdown());
        note.setBoundingBoxJson(mapper.serializeBoundingBox(request.boundingBox()));

        ReadingNote saved = noteRepository.save(note);
        return mapper.toReadingNoteDto(saved);
    }

    @Transactional
    public ReadingNoteDto updateNote(UUID noteId, UpdateNoteRequest request) {
        ReadingNote note = noteRepository.findByIdWithDocument(noteId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Reading note not found: " + noteId));
        if (request.selectedText() != null) {
            note.setSelectedText(request.selectedText());
        }
        note.setNoteMarkdown(request.noteMarkdown());
        if (request.boundingBox() != null) {
            note.setBoundingBoxJson(mapper.serializeBoundingBox(request.boundingBox()));
        }
        ReadingNote saved = noteRepository.save(note);
        return mapper.toReadingNoteDto(saved);
    }

    @Transactional
    public void deleteNote(UUID noteId) {
        if (!noteRepository.existsById(noteId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Reading note not found: " + noteId);
        }
        noteRepository.deleteById(noteId);
    }

    @Transactional(readOnly = true)
    public List<ReadingNoteDto> searchNotes(String query) {
        String cleanQuery = query != null ? query.strip() : "";
        return noteRepository.searchNotes(cleanQuery).stream()
                .map(mapper::toReadingNoteDto)
                .toList();
    }

    private Document findActiveDocumentOrThrow(UUID id) {
        return documentRepository.findById(id)
                .filter(d -> !d.isDeleted())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found: " + id));
    }
}

