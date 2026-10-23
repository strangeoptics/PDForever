package com.pdforever.service;

import com.pdforever.config.LibraryProperties;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Map;
import java.util.concurrent.*;

import static java.nio.file.StandardWatchEventKinds.*;

@Service
public class FileWatcherService {

    private static final Logger log = LoggerFactory.getLogger(FileWatcherService.class);

    private final LibraryProperties properties;
    private final DirectoryScannerService scannerService;
    private final Map<WatchKey, Path> watchKeys = new ConcurrentHashMap<>();
    private final Map<Path, CompletableFuture<Void>> pendingTasks = new ConcurrentHashMap<>();
    private final ExecutorService virtualExecutor = Executors.newVirtualThreadPerTaskExecutor();

    private WatchService watchService;
    private volatile boolean running = false;

    public FileWatcherService(LibraryProperties properties, DirectoryScannerService scannerService) {
        this.properties = properties;
        this.scannerService = scannerService;
    }

    @PostConstruct
    public void start() {
        if (!properties.watcherEnabled()) {
            log.info("Filesystem WatchService is disabled by configuration");
            return;
        }
        try {
            Path root = scannerService.getRootPath();
            Files.createDirectories(root);
            this.watchService = FileSystems.getDefault().newWatchService();
            registerRecursive(root);
            this.running = true;
            virtualExecutor.submit(this::watchLoop);
            log.info("Started recursive WatchService on {} (debounce={}ms)", root, properties.debounceMs());
        } catch (IOException e) {
            log.error("Failed to initialize WatchService: {}", e.getMessage(), e);
        }
    }

    private void registerRecursive(Path root) throws IOException {
        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                WatchKey key = dir.register(watchService, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
                watchKeys.put(key, dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private void watchLoop() {
        while (running) {
            WatchKey key;
            try {
                key = watchService.take();
            } catch (InterruptedException | ClosedWatchServiceException e) {
                Thread.currentThread().interrupt();
                break;
            }

            Path dir = watchKeys.get(key);
            if (dir == null) {
                key.reset();
                continue;
            }

            for (WatchEvent<?> event : key.pollEvents()) {
                WatchEvent.Kind<?> kind = event.kind();
                if (kind == OVERFLOW) {
                    continue;
                }

                @SuppressWarnings("unchecked")
                WatchEvent<Path> pathEvent = (WatchEvent<Path>) event;
                Path child = dir.resolve(pathEvent.context()).toAbsolutePath().normalize();

                if (kind == ENTRY_CREATE) {
                    if (Files.isDirectory(child)) {
                        try {
                            registerRecursive(child);
                        } catch (IOException e) {
                            log.warn("Could not register new directory {}: {}", child, e.getMessage());
                        }
                    } else if (scannerService.isPdfFile(child)) {
                        scheduleDebouncedIngestion(child);
                    }
                } else if (kind == ENTRY_MODIFY) {
                    if (scannerService.isPdfFile(child)) {
                        scheduleDebouncedIngestion(child);
                    }
                } else if (kind == ENTRY_DELETE) {
                    if (scannerService.isPdfFile(child)) {
                        cancelPendingTask(child);
                        scannerService.handleFileDeleted(child);
                    }
                }
            }

            boolean valid = key.reset();
            if (!valid) {
                watchKeys.remove(key);
            }
        }
    }

    /**
     * Debounces file creation/modification by verifying file size stability over the configured interval
     * (default 2,000 ms) before initiating PDF extraction and Lucene indexing.
     */
    public CompletableFuture<Void> scheduleDebouncedIngestion(Path filePath) {
        Path normalized = filePath.toAbsolutePath().normalize();
        return pendingTasks.compute(normalized, (path, existingFuture) -> {
            if (existingFuture != null && !existingFuture.isDone()) {
                return existingFuture;
            }
            return CompletableFuture.runAsync(() -> {
                try {
                    if (waitForFileSizeStability(path, properties.debounceMs(), 10)) {
                        scannerService.ingestOrUpdateFile(path);
                    }
                } finally {
                    pendingTasks.remove(path);
                }
            }, virtualExecutor);
        });
    }

    public boolean waitForFileSizeStability(Path filePath, long intervalMs, int maxAttempts) {
        try {
            long previousSize = -1L;
            for (int attempt = 0; attempt < maxAttempts; attempt++) {
                if (!Files.exists(filePath)) {
                    return false;
                }
                long currentSize = Files.size(filePath);
                if (currentSize > 0 && currentSize == previousSize) {
                    return true;
                }
                previousSize = currentSize;
                Thread.sleep(intervalMs);
            }
            return Files.exists(filePath) && Files.size(filePath) > 0;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } catch (IOException e) {
            log.warn("Error checking file size stability for {}: {}", filePath, e.getMessage());
            return false;
        }
    }

    private void cancelPendingTask(Path filePath) {
        CompletableFuture<Void> future = pendingTasks.remove(filePath.toAbsolutePath().normalize());
        if (future != null) {
            future.cancel(true);
        }
    }

    @PreDestroy
    public void stop() {
        running = false;
        try {
            if (watchService != null) {
                watchService.close();
            }
        } catch (IOException ignored) {
        }
        virtualExecutor.shutdownNow();
    }
}

