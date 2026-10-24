package com.pdforever.repository;

import com.pdforever.domain.ReadingNote;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ReadingNoteRepository extends JpaRepository<ReadingNote, UUID> {

    @Query("""
            SELECT n FROM ReadingNote n
            JOIN FETCH n.document d
            WHERE d.id = :documentId
            ORDER BY n.pageNumber ASC, n.createdAt ASC
            """)
    List<ReadingNote> findAllByDocumentIdOrderByPageNumberAscCreatedAtAsc(@Param("documentId") UUID documentId);

    @Query("""
            SELECT n FROM ReadingNote n
            JOIN FETCH n.document d
            WHERE n.id = :id
            """)
    Optional<ReadingNote> findByIdWithDocument(@Param("id") UUID id);

    int countByDocumentId(UUID documentId);

    @Query("""
            SELECT n.document.id, COUNT(n.id)
            FROM ReadingNote n
            WHERE n.document.id IN :docIds
            GROUP BY n.document.id
            """)
    List<Object[]> countNotesByDocumentIds(@Param("docIds") Collection<UUID> docIds);

    @Query("""
            SELECT COUNT(DISTINCT n.document.id), COUNT(n.id)
            FROM ReadingNote n
            JOIN n.document d
            WHERE d.isDeleted = false
              AND (:pathPrefix IS NULL OR :pathPrefix = '' OR d.relativePath = :pathPrefix OR d.relativePath LIKE CONCAT(:pathPrefix, '/%'))
            """)
    List<Object[]> computeNoteFacetCounts(@Param("pathPrefix") String pathPrefix);

    @Query("""
            SELECT n FROM ReadingNote n
            JOIN FETCH n.document d
            WHERE d.isDeleted = false
            """)
    List<ReadingNote> findAllForActiveDocuments();

    @Query("""
            SELECT n FROM ReadingNote n
            JOIN FETCH n.document d
            WHERE d.isDeleted = false
              AND (
                :query IS NULL
                OR :query = ''
                OR LOWER(n.noteMarkdown) LIKE LOWER(CONCAT('%', :query, '%'))
                OR LOWER(n.selectedText) LIKE LOWER(CONCAT('%', :query, '%'))
                OR LOWER(d.fileName) LIKE LOWER(CONCAT('%', :query, '%'))
              )
            ORDER BY n.updatedAt DESC
            """)
    List<ReadingNote> searchNotes(@Param("query") String query);
}
