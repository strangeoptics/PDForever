package com.pdforever.repository;

import com.pdforever.domain.Document;
import com.pdforever.domain.ReadingNote;
import com.pdforever.domain.Tag;
import com.pdforever.dto.DocumentFilterCriteria;
import jakarta.persistence.criteria.*;
import org.springframework.data.jpa.domain.Specification;

import java.util.*;
import java.util.stream.Collectors;

public final class DocumentSpecifications {

    private DocumentSpecifications() {
    }

    public static Specification<Document> fromCriteria(DocumentFilterCriteria criteria, boolean includeSorting) {
        return (root, query, cb) -> {
            DocumentFilterCriteria c = criteria != null ? criteria : DocumentFilterCriteria.empty();
            List<Predicate> predicates = new ArrayList<>();

            // 1. isDeleted = false (always enforced for active documents)
            predicates.add(cb.isFalse(root.get("isDeleted")));

            // 2. path prefix match
            String normPath = normalizePathPrefix(c.path());
            if (normPath != null && !normPath.isEmpty()) {
                Predicate exact = cb.equal(root.get("relativePath"), normPath);
                Predicate prefix = cb.like(root.get("relativePath"), normPath + "/%");
                predicates.add(cb.or(exact, prefix));
            }

            // 3. status
            if (c.status() != null && !c.status().isBlank()) {
                String normStatus = c.status().strip().toUpperCase(Locale.ROOT);
                Expression<String> statusExpr = cb.coalesce(root.get("readingStatus"), "UNREAD");
                predicates.add(cb.equal(cb.upper(statusExpr), normStatus));
            }

            // 3b. format (PDF, EPUB, EBOOK)
            if (c.format() != null && !c.format().isBlank()) {
                String reqFormat = c.format().strip().toUpperCase(Locale.ROOT);
                if ("EPUB".equals(reqFormat)) {
                    Predicate formatIsEpub = cb.equal(cb.upper(root.get("format")), "EPUB");
                    Predicate pathIsEpub = cb.like(cb.lower(root.get("relativePath")), "%.epub");
                    predicates.add(cb.or(formatIsEpub, pathIsEpub));
                } else if ("PDF".equals(reqFormat)) {
                    Predicate formatIsPdf = cb.equal(cb.upper(root.get("format")), "PDF");
                    Predicate formatNull = cb.isNull(root.get("format"));
                    Predicate notEpub = cb.notLike(cb.lower(root.get("relativePath")), "%.epub");
                    predicates.add(cb.and(cb.or(formatIsPdf, formatNull), notEpub));
                } else if ("EBOOK".equals(reqFormat) || "EBOOKS".equals(reqFormat)) {
                    Predicate formatEbook = cb.upper(root.get("format")).in("EPUB", "MOBI", "AZW", "AZW3");
                    Predicate pathEbook = cb.or(
                            cb.like(cb.lower(root.get("relativePath")), "%.epub"),
                            cb.like(cb.lower(root.get("relativePath")), "%.mobi"),
                            cb.like(cb.lower(root.get("relativePath")), "%.azw"),
                            cb.like(cb.lower(root.get("relativePath")), "%.azw3")
                    );
                    predicates.add(cb.or(formatEbook, pathEbook));
                } else {
                    predicates.add(cb.equal(cb.upper(root.get("format")), reqFormat));
                }
            }

            // 4. minPages / maxPages
            if (c.minPages() != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("pageCount"), c.minPages()));
            }
            if (c.maxPages() != null) {
                predicates.add(cb.lessThanOrEqualTo(root.get("pageCount"), c.maxPages()));
            }

            // 5. modifiedAfter / modifiedBefore
            if (c.modifiedAfter() != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("lastModifiedFs"), c.modifiedAfter()));
            }
            if (c.modifiedBefore() != null) {
                predicates.add(cb.lessThanOrEqualTo(root.get("lastModifiedFs"), c.modifiedBefore()));
            }

            // 6. yearFrom / yearTo
            if (c.yearFrom() != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("publicationYear"), c.yearFrom()));
            }
            if (c.yearTo() != null) {
                predicates.add(cb.lessThanOrEqualTo(root.get("publicationYear"), c.yearTo()));
            }

            // 7. hasMetadata
            if (c.hasMetadata() != null) {
                Predicate hasDoi = cb.and(cb.isNotNull(root.get("doi")), cb.notEqual(cb.trim(root.get("doi")), ""));
                Predicate hasIsbn = cb.and(cb.isNotNull(root.get("isbn")), cb.notEqual(cb.trim(root.get("isbn")), ""));
                Predicate hasTitle = cb.and(cb.isNotNull(root.get("metaTitle")), cb.notEqual(cb.trim(root.get("metaTitle")), ""));
                Predicate hasMeta = cb.or(hasDoi, hasIsbn, hasTitle);
                if (Boolean.TRUE.equals(c.hasMetadata())) {
                    predicates.add(hasMeta);
                } else {
                    predicates.add(cb.not(hasMeta));
                }
            }

            // 8. tags (must match all required tags)
            Set<String> requiredTags = parseTagFilterSet(c.tag());
            for (String tag : requiredTags) {
                Subquery<UUID> tagSub = query.subquery(UUID.class);
                Root<Document> subDoc = tagSub.from(Document.class);
                Join<Document, Tag> tagJoin = subDoc.join("tags");
                tagSub.select(subDoc.get("id"));
                tagSub.where(
                        cb.equal(subDoc.get("id"), root.get("id")),
                        cb.equal(cb.lower(tagJoin.get("name")), tag)
                );
                predicates.add(cb.exists(tagSub));
            }

            // 9. hasNotes
            if (c.hasNotes() != null) {
                Subquery<UUID> noteSub = query.subquery(UUID.class);
                Root<ReadingNote> noteRoot = noteSub.from(ReadingNote.class);
                noteSub.select(noteRoot.get("document").get("id"));
                noteSub.where(cb.equal(noteRoot.get("document").get("id"), root.get("id")));
                if (Boolean.TRUE.equals(c.hasNotes())) {
                    predicates.add(cb.exists(noteSub));
                } else {
                    predicates.add(cb.not(cb.exists(noteSub)));
                }
            }

            // 10. noteQuery
            if (c.noteQuery() != null && !c.noteQuery().isBlank()) {
                String pattern = "%" + c.noteQuery().strip().toLowerCase(Locale.ROOT) + "%";
                Subquery<UUID> noteQuerySub = query.subquery(UUID.class);
                Root<ReadingNote> noteRoot = noteQuerySub.from(ReadingNote.class);
                noteQuerySub.select(noteRoot.get("document").get("id"));
                Predicate matchDoc = cb.equal(noteRoot.get("document").get("id"), root.get("id"));
                Predicate matchText = cb.or(
                        cb.like(cb.lower(noteRoot.get("noteMarkdown")), pattern),
                        cb.like(cb.lower(noteRoot.get("selectedText")), pattern)
                );
                noteQuerySub.where(cb.and(matchDoc, matchText));
                predicates.add(cb.exists(noteQuerySub));
            }

            // Apply sorting if requested and not in a count query
            boolean isCountQuery = Long.class.equals(query.getResultType()) || long.class.equals(query.getResultType());
            if (includeSorting && !isCountQuery) {
                applySorting(root, query, cb, c.sortBy(), c.sortDir());
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }

    private static void applySorting(Root<Document> root, CriteriaQuery<?> query, CriteriaBuilder cb, String sortBy, String sortDir) {
        String field = sortBy != null ? sortBy.strip() : "fileName";
        boolean desc = "desc".equalsIgnoreCase(sortDir);

        switch (field) {
            case "lastModifiedFs", "date" -> {
                Order order = desc ? cb.desc(root.get("lastModifiedFs")) : cb.asc(root.get("lastModifiedFs"));
                query.orderBy(order, cb.asc(root.get("fileName")));
            }
            case "pageCount", "pages" -> {
                Order order = desc ? cb.desc(root.get("pageCount")) : cb.asc(root.get("pageCount"));
                query.orderBy(order, cb.asc(root.get("fileName")));
            }
            case "publicationYear", "year" -> {
                Order order = desc ? cb.desc(root.get("publicationYear")) : cb.asc(root.get("publicationYear"));
                query.orderBy(order, cb.asc(root.get("fileName")));
            }
            case "noteCount", "notes" -> {
                Subquery<Long> countSub = query.subquery(Long.class);
                Root<ReadingNote> noteRoot = countSub.from(ReadingNote.class);
                countSub.select(cb.count(noteRoot.get("id")));
                countSub.where(cb.equal(noteRoot.get("document").get("id"), root.get("id")));
                Order order = desc ? cb.desc(countSub) : cb.asc(countSub);
                query.orderBy(order, cb.asc(root.get("fileName")));
            }
            case "lastOpenedAt", "recent" -> {
                Order order = desc ? cb.desc(root.get("lastOpenedAt")) : cb.asc(root.get("lastOpenedAt"));
                query.orderBy(order, cb.asc(root.get("fileName")));
            }
            default -> {
                Expression<String> titleExpr = cb.selectCase()
                        .when(cb.and(
                                cb.isNotNull(root.get("metaTitle")),
                                cb.notEqual(cb.trim(root.get("metaTitle")), "")
                        ), root.get("metaTitle"))
                        .otherwise(root.get("fileName"))
                        .as(String.class);
                Expression<String> lowerTitle = cb.lower(titleExpr);
                Order order = desc ? cb.desc(lowerTitle) : cb.asc(lowerTitle);
                query.orderBy(order, cb.asc(root.get("fileName")));
            }
        }
    }

    public static String normalizePathPrefix(String path) {
        if (path == null) return null;
        String norm = path.replace('\\', '/').strip();
        while (norm.startsWith("/")) {
            norm = norm.substring(1);
        }
        while (norm.endsWith("/")) {
            norm = norm.substring(0, norm.length() - 1);
        }
        return norm;
    }

    public static Set<String> parseTagFilterSet(String rawTagParam) {
        if (rawTagParam == null || rawTagParam.isBlank()) {
            return Collections.emptySet();
        }
        return Arrays.stream(rawTagParam.split(","))
                .map(String::strip)
                .filter(s -> !s.isEmpty())
                .map(s -> s.toLowerCase(Locale.ROOT))
                .collect(Collectors.toSet());
    }
}

