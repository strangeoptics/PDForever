package com.pdforever.service;

import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import com.pdforever.domain.ReadingNote;
import com.pdforever.domain.Tag;
import com.pdforever.dto.*;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.repository.DocumentSpecifications;
import com.pdforever.repository.ReadingNoteRepository;
import com.pdforever.repository.TagRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.criteria.*;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;

@Service
public class LibraryManagementService {

    private final DocumentRepository documentRepository;
    private final TagRepository tagRepository;
    private final ReadingNoteRepository noteRepository;
    private final TagService tagService;
    private final ReadingNoteService readingNoteService;
    private final CoverThumbnailService coverThumbnailService;
    private final DocumentReadingProgressService readingProgressService;
    private final PdfExtractionService pdfExtractionService;
    private final EpubExtractionService epubExtractionService;
    private final MetadataEnrichmentService metadataEnrichmentService;
    private final DocumentDtoMapper mapper;
    private final StoragePathService storagePathService;
    @PersistenceContext
    private final EntityManager entityManager;

    public LibraryManagementService(
            DocumentRepository documentRepository,
            TagRepository tagRepository,
            ReadingNoteRepository noteRepository,
            TagService tagService,
            ReadingNoteService readingNoteService,
            CoverThumbnailService coverThumbnailService,
            DocumentReadingProgressService readingProgressService,
            PdfExtractionService pdfExtractionService,
            EpubExtractionService epubExtractionService,
            MetadataEnrichmentService metadataEnrichmentService,
            DocumentDtoMapper mapper,
            StoragePathService storagePathService,
            EntityManager entityManager
    ) {
        this.documentRepository = documentRepository;
        this.tagRepository = tagRepository;
        this.noteRepository = noteRepository;
        this.tagService = tagService;
        this.readingNoteService = readingNoteService;
        this.coverThumbnailService = coverThumbnailService;
        this.readingProgressService = readingProgressService;
        this.pdfExtractionService = pdfExtractionService;
        this.epubExtractionService = epubExtractionService;
        this.metadataEnrichmentService = metadataEnrichmentService;
        this.mapper = mapper;
        this.storagePathService = storagePathService;
        this.entityManager = entityManager;
    }

    // --- Document Queries & Facets ---

    @Transactional(readOnly = true)
    public Page<DocumentDto> getDocuments(String path, String tag, int page, int size) {
        return getDocuments(path, tag, null, page, size);
    }

    @Transactional(readOnly = true)
    public Page<DocumentDto> getDocuments(String path, String tag, String status, int page, int size) {
        DocumentFilterCriteria criteria = new DocumentFilterCriteria(
                path, tag, status, null, null, null, null, null, null, null, null, null, "fileName", "asc"
        );
        return getDocuments(criteria, page, size);
    }

    @Transactional(readOnly = true)
    public Page<DocumentDto> getDocuments(DocumentFilterCriteria criteria, int page, int size) {
        int clampedPage = Math.max(0, page);
        int clampedSize = Math.clamp(size, 1, 200);

        Specification<Document> spec = DocumentSpecifications.fromCriteria(criteria, true);
        PageRequest pageRequest = PageRequest.of(clampedPage, clampedSize);

        Page<Document> docPage = documentRepository.findAll(spec, pageRequest);
        List<Document> content = docPage.getContent();
        if (content.isEmpty()) {
            return new PageImpl<>(Collections.emptyList(), pageRequest, docPage.getTotalElements());
        }

        List<UUID> docIds = content.stream().map(Document::getId).toList();
        Map<UUID, Integer> noteCounts = loadNoteCountsForDocuments(docIds);

        List<DocumentDto> pageContent = content.stream()
                .map(doc -> toDocumentDto(doc, noteCounts.getOrDefault(doc.getId(), 0)))
                .toList();

        return new PageImpl<>(pageContent, pageRequest, docPage.getTotalElements());
    }

    @Transactional(readOnly = true)
    public Set<UUID> findMatchingDocumentIds(DocumentFilterCriteria criteria) {
        Specification<Document> spec = DocumentSpecifications.fromCriteria(criteria, false);
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaQuery<UUID> query = cb.createQuery(UUID.class);
        Root<Document> root = query.from(Document.class);
        query.select(root.get("id"));

        Predicate predicate = spec.toPredicate(root, query, cb);
        if (predicate != null) {
            query.where(predicate);
        }
        return new HashSet<>(entityManager.createQuery(query).getResultList());
    }

    @Transactional(readOnly = true)
    public DocumentFacetsDto getDocumentFacets(String path) {
        String normPath = DocumentSpecifications.normalizePathPrefix(path);
        List<Object[]> aggRows = documentRepository.computeDocumentAggregateFacets(normPath);
        Object[] agg = (aggRows != null && !aggRows.isEmpty()) ? aggRows.get(0) : new Object[12];

        int totalDocs = toInt(agg[0]);
        int unreadCount = toInt(agg[1]);
        int readingCount = toInt(agg[2]);
        int completedCount = toInt(agg[3]);
        int withMetadataCount = toInt(agg[4]);
        int shortDocsCount = toInt(agg[5]);
        int mediumDocsCount = toInt(agg[6]);
        int longDocsCount = toInt(agg[7]);
        int minPageCount = toInt(agg[8]);
        int maxPageCount = toInt(agg[9]);
        Integer minPubYear = toNullableInt(agg[10]);
        Integer maxPubYear = toNullableInt(agg[11]);

        List<Object[]> noteRows = noteRepository.computeNoteFacetCounts(normPath);
        Object[] noteAgg = (noteRows != null && !noteRows.isEmpty()) ? noteRows.get(0) : new Object[2];
        int withNotesCount = toInt(noteAgg[0]);
        int totalNotesCount = toInt(noteAgg[1]);

        List<Tag> allTags = tagRepository.findAllByOrderByNameAsc();
        List<Object[]> tagCountRows = documentRepository.countDocumentsPerTag(normPath);
        Map<Long, Integer> tagCounts = new HashMap<>();
        for (Object[] r : tagCountRows) {
            if (r != null && r.length >= 2 && r[0] instanceof Long tagId) {
                tagCounts.put(tagId, toInt(r[1]));
            }
        }

        List<DocumentFacetsDto.TagFacetDto> tagFacets = allTags.stream()
                .map(t -> new DocumentFacetsDto.TagFacetDto(
                        t.getId(),
                        t.getName(),
                        t.getColorHex(),
                        tagCounts.getOrDefault(t.getId(), 0)
                ))
                .toList();

        return new DocumentFacetsDto(
                totalDocs,
                unreadCount,
                readingCount,
                completedCount,
                withNotesCount,
                totalNotesCount,
                withMetadataCount,
                shortDocsCount,
                mediumDocsCount,
                longDocsCount,
                minPageCount,
                maxPageCount,
                minPubYear,
                maxPubYear,
                tagFacets
        );
    }

    public Map<UUID, Integer> loadNoteCountsForDocuments(Collection<UUID> docIds) {
        return mapper.loadNoteCountsForDocuments(docIds);
    }

    private int toInt(Object o) {
        return o instanceof Number n ? n.intValue() : 0;
    }

    private Integer toNullableInt(Object o) {
        return o instanceof Number n ? n.intValue() : null;
    }

    // --- Document Details & Reading Progress ---

    @Transactional(readOnly = true)
    public DocumentDto getDocument(UUID id) {
        Document doc = findActiveDocumentOrThrow(id);
        return toDocumentDto(doc);
    }

    @Transactional(readOnly = true)
    public Path getDocumentFilePath(UUID id) {
        Document doc = findActiveDocumentOrThrow(id);
        Path fullPath = storagePathService.resolveDocumentPath(doc.getRelativePath());
        if (!Files.exists(fullPath)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PDF file not found on disk: " + doc.getRelativePath());
        }
        return fullPath;
    }

    @Transactional(readOnly = true)
    public List<DocumentDto> getRecentDocuments(int limit) {
        return readingProgressService.getRecentDocuments(limit);
    }

    @Transactional
    public DocumentDto updateReadingProgress(UUID id, UpdateReadingProgressRequest request) {
        return readingProgressService.updateReadingProgress(id, request);
    }

    @Transactional(readOnly = true)
    public List<TocItemDto> getDocumentOutline(UUID id) {
        Document doc = findActiveDocumentOrThrow(id);
        Path filePath = getDocumentFilePath(id);
        if (doc.getFileName() != null && doc.getFileName().toLowerCase(Locale.ROOT).endsWith(".epub")) {
            return epubExtractionService.extractOutline(filePath);
        }
        return pdfExtractionService.extractOutline(filePath);
    }

    @Transactional(readOnly = true)
    public List<EpubExtractionService.ChapterInfo> getEpubChapters(UUID id) {
        Document doc = findActiveDocumentOrThrow(id);
        Path epubPath = storagePathService.resolveDocumentPath(doc.getRelativePath());
        return epubExtractionService.getChapters(epubPath);
    }

    @Transactional(readOnly = true)
    public String getEpubChapterHtml(UUID id, int chapterIndex) throws IOException {
        Document doc = findActiveDocumentOrThrow(id);
        Path epubPath = storagePathService.resolveDocumentPath(doc.getRelativePath());
        return epubExtractionService.getChapterHtml(epubPath, chapterIndex, id);
    }

    @Transactional(readOnly = true)
    public byte[] getEpubResource(UUID id, String resourcePath) throws IOException {
        Document doc = findActiveDocumentOrThrow(id);
        Path epubPath = storagePathService.resolveDocumentPath(doc.getRelativePath());
        return epubExtractionService.getResourceBytes(epubPath, resourcePath);
    }

    public String getEpubResourceMimeType(String resourcePath) {
        return epubExtractionService.guessMimeType(resourcePath);
    }

    // --- Cover Thumbnail Operations ---

    @Transactional(readOnly = true)
    public Path getOrCreateDocumentCover(UUID id) {
        return coverThumbnailService.getOrCreateDocumentCover(id);
    }

    public int clearCoverCache() {
        return coverThumbnailService.clearCoverCache();
    }

    // --- Tag Operations ---

    @Transactional(readOnly = true)
    public List<TagDto> getAllTags() {
        return tagService.getAllTags();
    }

    @Transactional
    public TagDto createTag(CreateTagRequest request) {
        return tagService.createTag(request);
    }

    @Transactional
    public void deleteTag(Long tagId) {
        tagService.deleteTag(tagId);
    }

    @Transactional
    public DocumentDto addTagToDocument(UUID documentId, Long tagId) {
        return tagService.addTagToDocument(documentId, tagId);
    }

    @Transactional
    public DocumentDto removeTagFromDocument(UUID documentId, Long tagId) {
        return tagService.removeTagFromDocument(documentId, tagId);
    }

    // --- Reading Note Operations ---

    @Transactional(readOnly = true)
    public List<ReadingNoteDto> getNotesForDocument(UUID documentId) {
        return readingNoteService.getNotesForDocument(documentId);
    }

    @Transactional
    public ReadingNoteDto createNote(CreateNoteRequest request) {
        return readingNoteService.createNote(request);
    }

    @Transactional
    public ReadingNoteDto updateNote(UUID noteId, UpdateNoteRequest request) {
        return readingNoteService.updateNote(noteId, request);
    }

    @Transactional
    public void deleteNote(UUID noteId) {
        readingNoteService.deleteNote(noteId);
    }

    @Transactional(readOnly = true)
    public List<ReadingNoteDto> searchNotes(String query) {
        return readingNoteService.searchNotes(query);
    }

    // --- Metadata Enrichment & Editing ---

    @Transactional
    public DocumentDto enrichDocumentMetadata(UUID id) {
        Document doc = findActiveDocumentOrThrow(id);
        Path pdfPath = getDocumentFilePath(id);
        metadataEnrichmentService.enrichDocument(doc, pdfPath, null, true);
        Document saved = documentRepository.save(doc);
        return toDocumentDto(saved);
    }

    @Transactional
    public DocumentDto updateDocumentMetadata(UUID id, UpdateMetadataRequest request) {
        Document doc = findActiveDocumentOrThrow(id);
        if (request.doi() != null) {
            doc.setDoi(request.doi().isBlank() ? null : request.doi().strip());
        }
        if (request.isbn() != null) {
            doc.setIsbn(request.isbn().isBlank() ? null : request.isbn().replaceAll("[\\s\\-\u2010-\u2015]", "").toUpperCase(Locale.ROOT));
        }
        if (request.metaTitle() != null) {
            doc.setMetaTitle(request.metaTitle().isBlank() ? null : request.metaTitle().strip());
        }
        if (request.authors() != null) {
            doc.setAuthors(request.authors().isBlank() ? null : request.authors().strip());
        }
        if (request.publicationYear() != null) {
            doc.setPublicationYear(request.publicationYear() > 0 ? request.publicationYear() : null);
        }
        if (request.abstractText() != null) {
            doc.setAbstractText(request.abstractText().isBlank() ? null : request.abstractText().strip());
        }
        doc.setMetadataSource("MANUAL");
        doc.setMetadataEnrichedAt(Instant.now());

        if ((doc.getMetaTitle() == null || doc.getMetaTitle().isBlank()) && (doc.getDoi() != null || doc.getIsbn() != null)) {
            Path pdfPath = getDocumentFilePath(id);
            metadataEnrichmentService.enrichDocument(doc, pdfPath, null, true);
        }

        Document saved = documentRepository.save(doc);
        return toDocumentDto(saved);
    }

    public MetadataEnrichmentReportDto enrichAllDocuments(boolean force) {
        List<Document> activeDocs = documentRepository.findAllByIsDeletedFalseOrderByRelativePathAsc();
        int scanned = 0;
        int identifiersDetected = 0;
        int enriched = 0;

        for (Document doc : activeDocs) {
            if (!force && doc.getMetadataEnrichedAt() != null && !"MANUAL".equalsIgnoreCase(doc.getMetadataSource())) {
                if (doc.getMetaTitle() != null && !doc.getMetaTitle().isBlank()) {
                    continue;
                }
            }
            if ("MANUAL".equalsIgnoreCase(doc.getMetadataSource()) && !force) {
                continue;
            }
            Path fullPath = storagePathService.resolveDocumentPath(doc.getRelativePath());
            if (!Files.exists(fullPath)) {
                continue;
            }
            scanned++;
            boolean changed = metadataEnrichmentService.enrichDocument(doc, fullPath, null, force);
            if (doc.getDoi() != null || doc.getIsbn() != null) {
                identifiersDetected++;
            }
            if (changed) {
                documentRepository.save(doc);
                enriched++;
            }
        }
        return new MetadataEnrichmentReportDto(scanned, identifiersDetected, enriched);
    }

    private Document findActiveDocumentOrThrow(UUID id) {
        return documentRepository.findById(id)
                .filter(d -> !d.isDeleted())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found: " + id));
    }

    public DocumentDto toDocumentDto(Document doc) {
        return mapper.toDocumentDto(doc);
    }

    public DocumentDto toDocumentDto(Document doc, int noteCount) {
        return mapper.toDocumentDto(doc, noteCount);
    }

    public TagDto toTagDto(Tag tag) {
        return mapper.toTagDto(tag);
    }

    public ReadingNoteDto toReadingNoteDto(ReadingNote note) {
        return mapper.toReadingNoteDto(note);
    }
}
