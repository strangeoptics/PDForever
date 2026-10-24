package com.pdforever;

import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import com.pdforever.service.LuceneIndexService;
import org.apache.lucene.index.Term;
import org.apache.lucene.search.IndexSearcher;
import org.apache.lucene.search.TermQuery;
import org.apache.lucene.search.TopDocs;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.CleanupMode;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LuceneIndexServiceTest {

    @TempDir(cleanup = CleanupMode.NEVER)
    Path tempDir;

    private LuceneIndexService luceneIndexService;

    @BeforeEach
    void setUp() throws IOException {
        Path luceneDir = tempDir.resolve("lucene");
        LibraryProperties properties = new LibraryProperties(
                tempDir.resolve("storage"),
                luceneDir,
                tempDir.resolve("covers"),
                500L,
                false,
                List.of(),
                List.of(),
                new LibraryProperties.RagProperties(false, "http://localhost:11434", "qwen2.5:14b", 6)
        );
        luceneIndexService = new LuceneIndexService(properties);
    }

    @AfterEach
    void tearDown() {
        if (luceneIndexService != null) {
            luceneIndexService.close();
        }
    }

    private Document createTestDocument(String fileName, String relPath) {
        Document doc = new Document();
        doc.setId(UUID.randomUUID());
        doc.setFileName(fileName);
        doc.setRelativePath(relPath);
        doc.setCreatedAt(Instant.now());
        doc.setPageCount(2);
        return doc;
    }

    @Test
    void testDeferredCommitInBatchMode() throws IOException {
        Document doc = createTestDocument("paper.pdf", "science/paper.pdf");
        List<String> pages = List.of("First page with quantum mechanics content.", "Second page with algorithms.");

        // Index in batch mode (commitImmediately = false)
        luceneIndexService.indexDocumentPages(doc, pages, false);

        assertThat(luceneIndexService.hasUncommittedChanges()).isTrue();

        // Searcher should not see the document before commit
        IndexSearcher searcherBefore = luceneIndexService.getSearcherManager().acquire();
        try {
            TopDocs hits = searcherBefore.search(new TermQuery(new Term(LuceneIndexService.FIELD_DOC_ID, doc.getId().toString())), 10);
            assertThat(hits.totalHits.value).isEqualTo(0);
        } finally {
            luceneIndexService.getSearcherManager().release(searcherBefore);
        }

        // Now commit the batch
        luceneIndexService.commit();
        assertThat(luceneIndexService.hasUncommittedChanges()).isFalse();

        // Searcher should now see the document
        IndexSearcher searcherAfter = luceneIndexService.getSearcherManager().acquire();
        try {
            TopDocs hits = searcherAfter.search(new TermQuery(new Term(LuceneIndexService.FIELD_DOC_ID, doc.getId().toString())), 10);
            assertThat(hits.totalHits.value).isEqualTo(2); // 2 pages
        } finally {
            luceneIndexService.getSearcherManager().release(searcherAfter);
        }
    }

    @Test
    void testImmediateCommitMode() throws IOException {
        Document doc = createTestDocument("single.pdf", "news/single.pdf");
        List<String> pages = List.of("Single file page text content.");

        // Default single-file indexing commits immediately
        luceneIndexService.indexDocumentPages(doc, pages);

        assertThat(luceneIndexService.hasUncommittedChanges()).isFalse();

        IndexSearcher searcher = luceneIndexService.getSearcherManager().acquire();
        try {
            TopDocs hits = searcher.search(new TermQuery(new Term(LuceneIndexService.FIELD_DOC_ID, doc.getId().toString())), 10);
            assertThat(hits.totalHits.value).isEqualTo(1);
        } finally {
            luceneIndexService.getSearcherManager().release(searcher);
        }
    }

    @Test
    void testBatchDeleteDeferredCommit() throws IOException {
        Document doc = createTestDocument("todelete.pdf", "misc/todelete.pdf");
        luceneIndexService.indexDocumentPages(doc, List.of("Page to be deleted"));

        // Delete with commitImmediately = false
        luceneIndexService.deleteDocument(doc.getId(), false);
        assertThat(luceneIndexService.hasUncommittedChanges()).isTrue();

        luceneIndexService.commit();
        assertThat(luceneIndexService.hasUncommittedChanges()).isFalse();

        IndexSearcher searcher = luceneIndexService.getSearcherManager().acquire();
        try {
            TopDocs hits = searcher.search(new TermQuery(new Term(LuceneIndexService.FIELD_DOC_ID, doc.getId().toString())), 10);
            assertThat(hits.totalHits.value).isEqualTo(0);
        } finally {
            luceneIndexService.getSearcherManager().release(searcher);
        }
    }
}

