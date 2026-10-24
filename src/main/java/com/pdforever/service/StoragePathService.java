package com.pdforever.service;

import com.pdforever.config.LibraryProperties;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

@Service
public class StoragePathService {

    private final Path rootPath;
    private final Path coversPath;
    private final Path lucenePath;

    public StoragePathService(LibraryProperties properties) {
        this.rootPath = properties.rootDir().toAbsolutePath().normalize();
        this.coversPath = properties.coversDir().toAbsolutePath().normalize();
        this.lucenePath = properties.luceneDir().toAbsolutePath().normalize();
    }

    public Path getRootPath() {
        return rootPath;
    }

    public Path getCoversPath() {
        return coversPath;
    }

    public Path getLucenePath() {
        return lucenePath;
    }

    public void ensureDirectoriesExist() throws IOException {
        Files.createDirectories(rootPath);
        Files.createDirectories(coversPath);
        Files.createDirectories(lucenePath);
    }

    /**
     * Converts a file path into a portable forward-slash relative path
     * relative to the library root.
     */
    public String toRelativePath(Path file) {
        Path normalizedFile = file.toAbsolutePath().normalize();
        return rootPath.relativize(normalizedFile).toString().replace('\\', '/');
    }

    /**
     * Resolves a portable relative path safely against the library root,
     * verifying that it does not escape root (path traversal protection).
     */
    public Path resolveDocumentPath(String relativePath) {
        if (relativePath == null || relativePath.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Relative path cannot be empty");
        }
        Path resolved = rootPath.resolve(relativePath).normalize();
        if (!resolved.startsWith(rootPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Path traversal attempt detected: " + relativePath);
        }
        return resolved;
    }

    /**
     * Resolves a document cover path safely against the covers directory.
     */
    public Path resolveCoverPath(UUID documentId) {
        if (documentId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Document ID cannot be null");
        }
        Path resolved = coversPath.resolve(documentId + ".jpg").normalize();
        if (!resolved.startsWith(coversPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid cover path for document ID: " + documentId);
        }
        return resolved;
    }
}

