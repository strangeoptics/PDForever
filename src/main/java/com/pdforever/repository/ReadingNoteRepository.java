package com.pdforever.repository;

import com.pdforever.domain.ReadingNote;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ReadingNoteRepository extends JpaRepository<ReadingNote, UUID> {

    List<ReadingNote> findAllByDocumentIdOrderByPageNumberAscCreatedAtAsc(UUID documentId);

    int countByDocumentId(UUID documentId);

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

