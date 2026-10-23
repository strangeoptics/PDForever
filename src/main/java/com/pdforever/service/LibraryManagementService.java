package com.pdforever.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pdforever.domain.Document;
import com.pdforever.domain.ReadingNote;
import com.pdforever.domain.Tag;
import com.pdforever.dto.*;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.repository.ReadingNoteRepository;
import com.pdforever.repository.TagRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;

@Service
public class LibraryManagementService {

    private final DocumentRepository documentRepository;
    private final TagRepository tagRepository;
    private final ReadingNoteRepository noteRepository;
    private final DirectoryScannerService scannerService;
    private final PdfExtractionService pdfExtractionService;
    private final ObjectMapper objectMapper;

    public LibraryManagementService(
            DocumentRepository documentRepository,
            TagRepository tagRepository,
            ReadingNoteRepository noteRepository,
            DirectoryScannerService scannerService,
            PdfExtractionService pdfExtractionService,
            ObjectMapper objectMapper
    ) {
        this.documentRepository = documentRepository;
        this.tagRepository = tagRepository;
        this.noteRepository = noteRepository;
        this.scannerService = scannerService;
        this.pdfExtractionService = pdfExtractionService;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public Page<DocumentDto> getDocuments(String path, String tag, int page, int size) {
        String normalizedPath = path != null ? path.replace('\\', '/').strip() : null;
        if (normalizedPath != null && normalizedPath.startsWith("/")) {
            normalizedPath = normalizedPath.substring(1);
        }
        if (normalizedPath != null && normalizedPath.endsWith("/")) {
            normalizedPath = normalizedPath.substring(0, normalizedPath.length() - 1);
        }
        String normalizedTag = tag != null ? tag.strip() : null;

        Page<Document> docs = documentRepository.findFilteredDocuments(
                normalizedPath,
                normalizedTag,
                PageRequest.of(Math.max(0, page), Math.clamp(size, 1, 200))
        );
        return docs.map(this::toDocumentDto);
    }

    @Transactional(readOnly = true)
    public DocumentDto getDocument(UUID id) {
        Document doc = findActiveDocumentOrThrow(id);
        return toDocumentDto(doc);
    }

    @Transactional(readOnly = true)
    public Path getDocumentFilePath(UUID id) {
        Document doc = findActiveDocumentOrThrow(id);
        Path fullPath = scannerService.getRootPath().resolve(doc.getRelativePath()).normalize();
        if (!fullPath.startsWith(scannerService.getRootPath()) || !Files.exists(fullPath)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PDF file not found on disk: " + doc.getRelativePath());
        }
        return fullPath;
    }

    @Transactional(readOnly = true)
    public Path getOrCreateDocumentCover(UUID id) {
        Path pdfPath = getDocumentFilePath(id);
        Path coversDir = scannerService.getCoversPath();
        Path coverPath = coversDir.resolve(id + ".jpg").normalize();
        if (!coverPath.startsWith(coversDir)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid document id");
        }

        try {
            if (Files.exists(coverPath) && Files.size(coverPath) > 0) {
                long coverMtime = Files.getLastModifiedTime(coverPath).toMillis();
                long pdfMtime = Files.getLastModifiedTime(pdfPath).toMillis();
                if (coverMtime >= pdfMtime) {
                    return coverPath;
                }
            }
        } catch (IOException ignored) {
        }

        boolean rendered = pdfExtractionService.renderCoverImage(pdfPath, coverPath);
        if (!rendered || !Files.exists(coverPath)) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Could not render cover image for document: " + id);
        }
        return coverPath;
    }

    public int clearCoverCache() {
        Path coversDir = scannerService.getCoversPath();
        if (!Files.exists(coversDir) || !Files.isDirectory(coversDir)) {
            return 0;
        }
        int deleted = 0;
        try (Stream<Path> files = Files.list(coversDir)) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                if (file.getFileName().toString().toLowerCase().endsWith(".jpg")) {
                    if (Files.deleteIfExists(file)) {
                        deleted++;
                    }
                }
            }
        } catch (IOException ignored) {
        }
        return deleted;
    }

    @Transactional(readOnly = true)
    public List<TagDto> getAllTags() {
        return tagRepository.findAllByOrderByNameAsc().stream()
                .map(this::toTagDto)
                .toList();
    }

    @Transactional
    public TagDto createTag(CreateTagRequest request) {
        String cleanName = request.name().strip();
        return tagRepository.findByNameIgnoreCase(cleanName)
                .map(this::toTagDto)
                .orElseGet(() -> {
                    String color = (request.colorHex() != null && !request.colorHex().isBlank())
                            ? request.colorHex().strip()
                            : "#3b82f6";
                    Tag saved = tagRepository.save(new Tag(cleanName, color));
                    return toTagDto(saved);
                });
    }

    @Transactional
    public void deleteTag(Long tagId) {
        Tag tag = tagRepository.findById(tagId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Tag not found: " + tagId));
        List<Document> docs = documentRepository.findAll();
        for (Document doc : docs) {
            if (doc.getTags().removeIf(t -> t.getId().equals(tagId))) {
                documentRepository.save(doc);
            }
        }
        tagRepository.delete(tag);
    }

    @Transactional
    public DocumentDto addTagToDocument(UUID documentId, Long tagId) {
        Document doc = findActiveDocumentOrThrow(documentId);
        Tag tag = tagRepository.findById(tagId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Tag not found: " + tagId));
        doc.getTags().add(tag);
        Document saved = documentRepository.save(doc);
        return toDocumentDto(saved);
    }

    @Transactional
    public DocumentDto removeTagFromDocument(UUID documentId, Long tagId) {
        Document doc = findActiveDocumentOrThrow(documentId);
        doc.getTags().removeIf(t -> t.getId().equals(tagId));
        Document saved = documentRepository.save(doc);
        return toDocumentDto(saved);
    }

    @Transactional(readOnly = true)
    public List<ReadingNoteDto> getNotesForDocument(UUID documentId) {
        findActiveDocumentOrThrow(documentId);
        return noteRepository.findAllByDocumentIdOrderByPageNumberAscCreatedAtAsc(documentId).stream()
                .map(this::toReadingNoteDto)
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
        note.setBoundingBoxJson(serializeBoundingBox(request.boundingBox()));

        ReadingNote saved = noteRepository.save(note);
        return toReadingNoteDto(saved);
    }

    @Transactional
    public ReadingNoteDto updateNote(UUID noteId, UpdateNoteRequest request) {
        ReadingNote note = noteRepository.findById(noteId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Reading note not found: " + noteId));
        if (request.selectedText() != null) {
            note.setSelectedText(request.selectedText());
        }
        note.setNoteMarkdown(request.noteMarkdown());
        if (request.boundingBox() != null) {
            note.setBoundingBoxJson(serializeBoundingBox(request.boundingBox()));
        }
        ReadingNote saved = noteRepository.save(note);
        return toReadingNoteDto(saved);
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
                .map(this::toReadingNoteDto)
                .toList();
    }

    private Document findActiveDocumentOrThrow(UUID id) {
        return documentRepository.findById(id)
                .filter(d -> !d.isDeleted())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found: " + id));
    }

    public DocumentDto toDocumentDto(Document doc) {
        List<TagDto> sortedTags = doc.getTags().stream()
                .sorted(Comparator.comparing(Tag::getName, String.CASE_INSENSITIVE_ORDER))
                .map(this::toTagDto)
                .toList();
        return new DocumentDto(
                doc.getId(),
                doc.getRelativePath(),
                doc.getFileName(),
                doc.getFileSizeBytes(),
                doc.getPageCount(),
                doc.getLastModifiedFs(),
                doc.getCreatedAt(),
                sortedTags
        );
    }

    public TagDto toTagDto(Tag tag) {
        return new TagDto(tag.getId(), tag.getName(), tag.getColorHex());
    }

    public ReadingNoteDto toReadingNoteDto(ReadingNote note) {
        Document doc = note.getDocument();
        return new ReadingNoteDto(
                note.getId(),
                doc.getId(),
                doc.getFileName(),
                doc.getRelativePath(),
                note.getPageNumber(),
                note.getSelectedText(),
                note.getNoteMarkdown(),
                deserializeBoundingBox(note.getBoundingBoxJson()),
                note.getCreatedAt(),
                note.getUpdatedAt()
        );
    }

    private String serializeBoundingBox(BoundingBoxDto bbox) {
        try {
            return objectMapper.writeValueAsString(bbox);
        } catch (JsonProcessingException e) {
            return "{\"x1\":0.1,\"y1\":0.1,\"x2\":0.9,\"y2\":0.15}";
        }
    }

    private BoundingBoxDto deserializeBoundingBox(String json) {
        if (json == null || json.isBlank()) {
            return new BoundingBoxDto(0.1, 0.1, 0.9, 0.15);
        }
        try {
            return objectMapper.readValue(json, BoundingBoxDto.class);
        } catch (JsonProcessingException e) {
            return new BoundingBoxDto(0.1, 0.1, 0.9, 0.15);
        }
    }
}

