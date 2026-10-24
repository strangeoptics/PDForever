package com.pdforever.service;

import com.pdforever.domain.Document;
import com.pdforever.domain.Tag;
import com.pdforever.dto.CreateTagRequest;
import com.pdforever.dto.DocumentDto;
import com.pdforever.dto.TagDto;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.repository.TagRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@Service
public class TagService {

    private final TagRepository tagRepository;
    private final DocumentRepository documentRepository;
    private final DocumentDtoMapper mapper;

    public TagService(
            TagRepository tagRepository,
            DocumentRepository documentRepository,
            DocumentDtoMapper mapper
    ) {
        this.tagRepository = tagRepository;
        this.documentRepository = documentRepository;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public List<TagDto> getAllTags() {
        return tagRepository.findAllByOrderByNameAsc().stream()
                .map(mapper::toTagDto)
                .toList();
    }

    @Transactional
    public TagDto createTag(CreateTagRequest request) {
        String cleanName = request.name().strip();
        return tagRepository.findByNameIgnoreCase(cleanName)
                .map(mapper::toTagDto)
                .orElseGet(() -> {
                    String color = (request.colorHex() != null && !request.colorHex().isBlank())
                            ? request.colorHex().strip()
                            : "#3b82f6";
                    Tag saved = tagRepository.save(new Tag(cleanName, color));
                    return mapper.toTagDto(saved);
                });
    }

    @Transactional
    public void deleteTag(Long tagId) {
        Tag tag = tagRepository.findById(tagId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Tag not found: " + tagId));
        tagRepository.deleteDocumentTagAssociations(tagId);
        tagRepository.delete(tag);
    }

    @Transactional
    public DocumentDto addTagToDocument(UUID documentId, Long tagId) {
        Document doc = findActiveDocumentOrThrow(documentId);
        Tag tag = tagRepository.findById(tagId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Tag not found: " + tagId));
        doc.getTags().add(tag);
        Document saved = documentRepository.save(doc);
        return mapper.toDocumentDto(saved);
    }

    @Transactional
    public DocumentDto removeTagFromDocument(UUID documentId, Long tagId) {
        Document doc = findActiveDocumentOrThrow(documentId);
        doc.getTags().removeIf(t -> t.getId().equals(tagId));
        Document saved = documentRepository.save(doc);
        return mapper.toDocumentDto(saved);
    }

    private Document findActiveDocumentOrThrow(UUID id) {
        return documentRepository.findById(id)
                .filter(d -> !d.isDeleted())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found: " + id));
    }
}

