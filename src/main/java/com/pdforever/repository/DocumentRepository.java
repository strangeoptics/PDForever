package com.pdforever.repository;

import com.pdforever.domain.Document;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface DocumentRepository extends JpaRepository<Document, UUID>, JpaSpecificationExecutor<Document> {

    Optional<Document> findByRelativePath(String relativePath);

    List<Document> findAllByIsDeletedFalseOrderByRelativePathAsc();

    @Query("""
            SELECT d FROM Document d
            WHERE d.isDeleted = false
              AND (d.lastOpenedAt IS NOT NULL OR d.readingStatus = 'READING')
            ORDER BY d.lastOpenedAt DESC, d.lastModifiedFs DESC
            """)
    List<Document> findRecentlyReadDocuments(Pageable pageable);

    @Query("""
            SELECT
                COUNT(d),
                SUM(CASE WHEN UPPER(COALESCE(d.readingStatus, 'UNREAD')) = 'UNREAD' THEN 1 ELSE 0 END),
                SUM(CASE WHEN UPPER(d.readingStatus) = 'READING' THEN 1 ELSE 0 END),
                SUM(CASE WHEN UPPER(d.readingStatus) = 'COMPLETED' THEN 1 ELSE 0 END),
                SUM(CASE WHEN (d.doi IS NOT NULL AND TRIM(d.doi) <> '') OR (d.isbn IS NOT NULL AND TRIM(d.isbn) <> '') OR (d.metaTitle IS NOT NULL AND TRIM(d.metaTitle) <> '') THEN 1 ELSE 0 END),
                SUM(CASE WHEN d.pageCount > 0 AND d.pageCount <= 20 THEN 1 ELSE 0 END),
                SUM(CASE WHEN d.pageCount > 20 AND d.pageCount <= 100 THEN 1 ELSE 0 END),
                SUM(CASE WHEN d.pageCount > 100 THEN 1 ELSE 0 END),
                COALESCE(MIN(CASE WHEN d.pageCount > 0 THEN d.pageCount ELSE NULL END), 0),
                COALESCE(MAX(d.pageCount), 0),
                MIN(d.publicationYear),
                MAX(d.publicationYear)
            FROM Document d
            WHERE d.isDeleted = false
              AND (:pathPrefix IS NULL OR :pathPrefix = '' OR d.relativePath = :pathPrefix OR d.relativePath LIKE CONCAT(:pathPrefix, '/%'))
            """)
    List<Object[]> computeDocumentAggregateFacets(@Param("pathPrefix") String pathPrefix);

    @Query("""
            SELECT t.id, COUNT(d.id)
            FROM Document d
            JOIN d.tags t
            WHERE d.isDeleted = false
              AND (:pathPrefix IS NULL OR :pathPrefix = '' OR d.relativePath = :pathPrefix OR d.relativePath LIKE CONCAT(:pathPrefix, '/%'))
            GROUP BY t.id
            """)
    List<Object[]> countDocumentsPerTag(@Param("pathPrefix") String pathPrefix);

    public interface DocumentTreeItem {
        UUID getId();
        String getRelativePath();
        String getFileName();
        Integer getPageCount();
    }

    @Query("""
            SELECT d.id AS id, d.relativePath AS relativePath, d.fileName AS fileName, d.pageCount AS pageCount
            FROM Document d
            WHERE d.isDeleted = false
            ORDER BY d.relativePath ASC
            """)
    List<DocumentTreeItem> findActiveTreeItems();
}
