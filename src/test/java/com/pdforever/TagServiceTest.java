package com.pdforever;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import com.pdforever.domain.Tag;
import com.pdforever.dto.CreateTagRequest;
import com.pdforever.dto.DocumentDto;
import com.pdforever.dto.TagDto;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.repository.ReadingNoteRepository;
import com.pdforever.repository.TagRepository;
import com.pdforever.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class TagServiceTest {

    private static Path tempDir;

    static {
        try {
            tempDir = Files.createTempDirectory("pdforever-tagservice-test");
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        Path dbPath = tempDir.resolve("test-tagservice.db");
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + dbPath.toAbsolutePath().toString().replace('\\', '/') + "?journal_mode=WAL&busy_timeout=5000&foreign_keys=on");
        registry.add("library.root-dir", () -> tempDir.resolve("storage").toString());
        registry.add("library.lucene-dir", () -> tempDir.resolve("lucene").toString());
        registry.add("library.covers-dir", () -> tempDir.resolve("covers").toString());
        registry.add("library.watcher-enabled", () -> "false");
        registry.add("library.metadata-lookup-enabled", () -> "false");
    }

    @Autowired
    private TagService tagService;

    @Autowired
    private TagRepository tagRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @BeforeEach
    void setUp() {
        documentRepository.deleteAll();
        tagRepository.deleteAll();
    }

    private Document createTestDoc(String fileName, String relPath) {
        Document doc = new Document();
        doc.setId(UUID.randomUUID());
        doc.setFileName(fileName);
        doc.setRelativePath(relPath);
        doc.setFileSizeBytes(2048L);
        doc.setPageCount(10);
        doc.setLastModifiedFs(Instant.now());
        doc.setCreatedAt(Instant.now());
        doc.setDeleted(false);
        return documentRepository.save(doc);
    }

    @Test
    void testCreateAndGetAllTags() {
        TagDto created = tagService.createTag(new CreateTagRequest("Academic", "#10b981"));
        assertThat(created.name()).isEqualTo("Academic");
        assertThat(created.colorHex()).isEqualTo("#10b981");

        List<TagDto> allTags = tagService.getAllTags();
        assertThat(allTags).hasSize(1);
        assertThat(allTags.get(0).name()).isEqualTo("Academic");
    }

    @Test
    void testAddAndRemoveTagFromDocument() {
        TagDto tag = tagService.createTag(new CreateTagRequest("Outdoor", "#f59e0b"));
        Document savedDoc = createTestDoc("outdoor.pdf", "outdoor.pdf");

        DocumentDto withTag = tagService.addTagToDocument(savedDoc.getId(), tag.id());
        assertThat(withTag.tags()).extracting(TagDto::name).containsExactly("Outdoor");

        DocumentDto withoutTag = tagService.removeTagFromDocument(savedDoc.getId(), tag.id());
        assertThat(withoutTag.tags()).isEmpty();
    }

    @Test
    void testDeleteTagRemovesAssociationEfficiently() {
        TagDto tag = tagService.createTag(new CreateTagRequest("ToRemove", "#ef4444"));
        Document savedDoc = createTestDoc("sample.pdf", "sample.pdf");

        DocumentDto withTag = tagService.addTagToDocument(savedDoc.getId(), tag.id());
        assertThat(withTag.tags()).extracting(TagDto::name).containsExactly("ToRemove");

        // Delete tag
        tagService.deleteTag(tag.id());

        assertThat(tagRepository.findById(tag.id())).isEmpty();

        DocumentDto reloadedDto = tagService.removeTagFromDocument(savedDoc.getId(), tag.id());
        assertThat(reloadedDto.tags()).isEmpty();
    }
}
