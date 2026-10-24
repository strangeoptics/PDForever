package com.pdforever;

import com.pdforever.config.LibraryProperties;
import com.pdforever.service.StoragePathService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.CleanupMode;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class StoragePathServiceTest {

    @TempDir(cleanup = CleanupMode.NEVER)
    Path tempDir;

    private StoragePathService storagePathService;
    private Path storageDir;
    private Path coversDir;

    @BeforeEach
    void setUp() throws IOException {
        storageDir = tempDir.resolve("storage");
        coversDir = tempDir.resolve("covers");
        Path luceneDir = tempDir.resolve("lucene");

        LibraryProperties properties = new LibraryProperties(
                storageDir,
                luceneDir,
                coversDir,
                500L,
                false,
                List.of(),
                List.of(),
                new LibraryProperties.RagProperties(false, "http://localhost:11434", "qwen2.5:14b", 6)
        );
        storagePathService = new StoragePathService(properties);
        storagePathService.ensureDirectoriesExist();
    }

    @Test
    void testToRelativePathConvertsCorrectly() {
        Path file = storageDir.resolve("science/physics/quantum.pdf");
        String relPath = storagePathService.toRelativePath(file);
        assertThat(relPath).isEqualTo("science/physics/quantum.pdf");
    }

    @Test
    void testResolveDocumentPathSafely() {
        Path resolved = storagePathService.resolveDocumentPath("books/history/ww2.pdf");
        assertThat(resolved).isEqualTo(storageDir.resolve("books/history/ww2.pdf").normalize());
    }

    @Test
    void testResolveDocumentPathRejectsPathTraversal() {
        assertThatThrownBy(() -> storagePathService.resolveDocumentPath("../../windows/system32/cmd.exe"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("Path traversal attempt detected");
    }

    @Test
    void testResolveCoverPathSafely() {
        UUID docId = UUID.randomUUID();
        Path cover = storagePathService.resolveCoverPath(docId);
        assertThat(cover).isEqualTo(coversDir.resolve(docId + ".jpg").normalize());
    }
}

