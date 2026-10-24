package com.pdforever.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.BatchSize;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(
        name = "documents",
        indexes = {
                @Index(name = "idx_document_relative_path", columnList = "relative_path", unique = true),
                @Index(name = "idx_document_is_deleted", columnList = "is_deleted")
        }
)
public class Document {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(length = 36, nullable = false, updatable = false)
    private UUID id;

    @Column(name = "relative_path", nullable = false, unique = true)
    private String relativePath;

    @Column(name = "file_name", nullable = false)
    private String fileName;

    @Column(name = "file_size_bytes", nullable = false)
    private Long fileSizeBytes;

    @Column(name = "page_count", nullable = false)
    private Integer pageCount;

    @Column(name = "last_modified_fs", nullable = false)
    private Instant lastModifiedFs;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "is_deleted", nullable = false)
    private boolean isDeleted = false;

    @Column(name = "reading_status", length = 32)
    private String readingStatus = "UNREAD";

    @Column(name = "last_read_page")
    private Integer lastReadPage = 1;

    @Column(name = "last_opened_at")
    private Instant lastOpenedAt;

    @Column(name = "doi", length = 128)
    private String doi;

    @Column(name = "isbn", length = 32)
    private String isbn;

    @Column(name = "meta_title", length = 512)
    private String metaTitle;

    @Column(name = "authors", length = 512)
    private String authors;

    @Column(name = "publication_year")
    private Integer publicationYear;

    @Column(name = "abstract_text", columnDefinition = "TEXT")
    private String abstractText;

    @Column(name = "metadata_source", length = 64)
    private String metadataSource;

    @Column(name = "metadata_enriched_at")
    private Instant metadataEnrichedAt;

    @Column(name = "format", length = 16)
    private String format = "PDF";

    @ManyToMany(fetch = FetchType.LAZY)
    @BatchSize(size = 50)
    @JoinTable(
            name = "document_tags",
            joinColumns = @JoinColumn(name = "document_id"),
            inverseJoinColumns = @JoinColumn(name = "tag_id")
    )
    private Set<Tag> tags = new HashSet<>();

    public Document() {
    }

    @PrePersist
    protected void onCreate() {
        if (this.createdAt == null) {
            this.createdAt = Instant.now();
        }
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getRelativePath() {
        return relativePath;
    }

    public void setRelativePath(String relativePath) {
        this.relativePath = relativePath;
    }

    public String getFileName() {
        return fileName;
    }

    public void setFileName(String fileName) {
        this.fileName = fileName;
    }

    public Long getFileSizeBytes() {
        return fileSizeBytes;
    }

    public void setFileSizeBytes(Long fileSizeBytes) {
        this.fileSizeBytes = fileSizeBytes;
    }

    public Integer getPageCount() {
        return pageCount;
    }

    public void setPageCount(Integer pageCount) {
        this.pageCount = pageCount;
    }

    public Instant getLastModifiedFs() {
        return lastModifiedFs;
    }

    public void setLastModifiedFs(Instant lastModifiedFs) {
        this.lastModifiedFs = lastModifiedFs;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public boolean isDeleted() {
        return isDeleted;
    }

    public void setDeleted(boolean deleted) {
        isDeleted = deleted;
    }

    public String getReadingStatus() {
        return readingStatus != null && !readingStatus.isBlank() ? readingStatus : "UNREAD";
    }

    public void setReadingStatus(String readingStatus) {
        this.readingStatus = readingStatus;
    }

    public Integer getLastReadPage() {
        return lastReadPage != null && lastReadPage >= 1 ? lastReadPage : 1;
    }

    public void setLastReadPage(Integer lastReadPage) {
        this.lastReadPage = lastReadPage;
    }

    public Instant getLastOpenedAt() {
        return lastOpenedAt;
    }

    public void setLastOpenedAt(Instant lastOpenedAt) {
        this.lastOpenedAt = lastOpenedAt;
    }

    public String getDoi() {
        return doi;
    }

    public void setDoi(String doi) {
        this.doi = doi;
    }

    public String getIsbn() {
        return isbn;
    }

    public void setIsbn(String isbn) {
        this.isbn = isbn;
    }

    public String getMetaTitle() {
        return metaTitle;
    }

    public void setMetaTitle(String metaTitle) {
        this.metaTitle = metaTitle;
    }

    public String getAuthors() {
        return authors;
    }

    public void setAuthors(String authors) {
        this.authors = authors;
    }

    public Integer getPublicationYear() {
        return publicationYear;
    }

    public void setPublicationYear(Integer publicationYear) {
        this.publicationYear = publicationYear;
    }

    public String getAbstractText() {
        return abstractText;
    }

    public void setAbstractText(String abstractText) {
        this.abstractText = abstractText;
    }

    public String getMetadataSource() {
        return metadataSource;
    }

    public void setMetadataSource(String metadataSource) {
        this.metadataSource = metadataSource;
    }

    public Instant getMetadataEnrichedAt() {
        return metadataEnrichedAt;
    }

    public void setMetadataEnrichedAt(Instant metadataEnrichedAt) {
        this.metadataEnrichedAt = metadataEnrichedAt;
    }

    public String getFormat() {
        if (format == null) {
            if (fileName != null) {
                String lower = fileName.toLowerCase(java.util.Locale.ROOT);
                if (lower.endsWith(".epub")) return "EPUB";
                if (lower.endsWith(".mobi")) return "MOBI";
                if (lower.endsWith(".azw") || lower.endsWith(".azw3")) return "AZW";
            }
            if (relativePath != null) {
                String lower = relativePath.toLowerCase(java.util.Locale.ROOT);
                if (lower.endsWith(".epub")) return "EPUB";
                if (lower.endsWith(".mobi")) return "MOBI";
                if (lower.endsWith(".azw") || lower.endsWith(".azw3")) return "AZW";
            }
            return "PDF";
        }
        return format;
    }

    public void setFormat(String format) {
        this.format = format;
    }

    public Set<Tag> getTags() {
        return tags;
    }

    public void setTags(Set<Tag> tags) {
        this.tags = tags;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Document document)) return false;
        return Objects.equals(id, document.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }
}

