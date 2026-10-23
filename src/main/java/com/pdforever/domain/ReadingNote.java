package com.pdforever.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(
        name = "reading_notes",
        indexes = {
                @Index(name = "idx_reading_note_page_number", columnList = "page_number"),
                @Index(name = "idx_reading_note_document_id", columnList = "document_id")
        }
)
public class ReadingNote {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(length = 36, nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Document document;

    @Column(name = "page_number", nullable = false)
    private Integer pageNumber;

    @Column(name = "selected_text", columnDefinition = "TEXT")
    private String selectedText;

    @Column(name = "note_markdown", columnDefinition = "TEXT", nullable = false)
    private String noteMarkdown;

    @Column(name = "bounding_box_json", columnDefinition = "TEXT", nullable = false)
    private String boundingBoxJson;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public ReadingNote() {
    }

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        if (this.createdAt == null) {
            this.createdAt = now;
        }
        this.updatedAt = now;
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public Document getDocument() {
        return document;
    }

    public void setDocument(Document document) {
        this.document = document;
    }

    public Integer getPageNumber() {
        return pageNumber;
    }

    public void setPageNumber(Integer pageNumber) {
        this.pageNumber = pageNumber;
    }

    public String getSelectedText() {
        return selectedText;
    }

    public void setSelectedText(String selectedText) {
        this.selectedText = selectedText;
    }

    public String getNoteMarkdown() {
        return noteMarkdown;
    }

    public void setNoteMarkdown(String noteMarkdown) {
        this.noteMarkdown = noteMarkdown;
    }

    public String getBoundingBoxJson() {
        return boundingBoxJson;
    }

    public void setBoundingBoxJson(String boundingBoxJson) {
        this.boundingBoxJson = boundingBoxJson;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ReadingNote that)) return false;
        return Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }
}

