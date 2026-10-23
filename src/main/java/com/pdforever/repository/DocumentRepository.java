package com.pdforever.repository;

import com.pdforever.domain.Document;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface DocumentRepository extends JpaRepository<Document, UUID> {

    Optional<Document> findByRelativePath(String relativePath);

    List<Document> findAllByIsDeletedFalseOrderByRelativePathAsc();

    @Query("""
            SELECT DISTINCT d FROM Document d
            LEFT JOIN d.tags t
            WHERE d.isDeleted = false
              AND (:pathPrefix IS NULL OR :pathPrefix = '' OR d.relativePath = :pathPrefix OR d.relativePath LIKE CONCAT(:pathPrefix, '/%'))
              AND (:tagName IS NULL OR :tagName = '' OR LOWER(t.name) = LOWER(:tagName))
            ORDER BY d.fileName ASC
            """)
    Page<Document> findFilteredDocuments(
            @Param("pathPrefix") String pathPrefix,
            @Param("tagName") String tagName,
            Pageable pageable
    );
}

