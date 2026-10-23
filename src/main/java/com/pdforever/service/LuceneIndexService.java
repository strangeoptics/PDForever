package com.pdforever.service;

import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import jakarta.annotation.PreDestroy;
import org.apache.lucene.analysis.Analyzer;
import org.apache.lucene.analysis.standard.StandardAnalyzer;
import org.apache.lucene.document.*;
import org.apache.lucene.index.IndexOptions;
import org.apache.lucene.index.IndexWriter;
import org.apache.lucene.index.IndexWriterConfig;
import org.apache.lucene.index.Term;
import org.apache.lucene.search.SearcherFactory;
import org.apache.lucene.search.SearcherManager;
import org.apache.lucene.search.similarities.BM25Similarity;
import org.apache.lucene.store.Directory;
import org.apache.lucene.store.FSDirectory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

@Service
public class LuceneIndexService {

    private static final Logger log = LoggerFactory.getLogger(LuceneIndexService.class);

    public static final String FIELD_DOC_ID = "docId";
    public static final String FIELD_REL_PATH = "relPath";
    public static final String FIELD_TITLE = "title";
    public static final String FIELD_PAGE_NUMBER = "pageNumber";
    public static final String FIELD_CONTENT = "content";
    public static final String FIELD_PAGE_TEXT_STORED = "_pageText";

    /**
     * TextField (not stored) with TermVectors, Positions, and Offsets enabled for UnifiedHighlighter.
     */
    public static final FieldType CONTENT_FIELD_TYPE;

    static {
        FieldType ft = new FieldType(TextField.TYPE_NOT_STORED);
        ft.setIndexOptions(IndexOptions.DOCS_AND_FREQS_AND_POSITIONS_AND_OFFSETS);
        ft.setStoreTermVectors(true);
        ft.setStoreTermVectorPositions(true);
        ft.setStoreTermVectorOffsets(true);
        ft.freeze();
        CONTENT_FIELD_TYPE = ft;
    }

    private final Directory directory;
    private final Analyzer analyzer;
    private final IndexWriter indexWriter;
    private final SearcherManager searcherManager;

    public LuceneIndexService(LibraryProperties properties) throws IOException {
        Path lucenePath = properties.luceneDir().toAbsolutePath().normalize();
        Files.createDirectories(lucenePath);
        this.directory = FSDirectory.open(lucenePath);
        this.analyzer = new StandardAnalyzer();

        IndexWriterConfig config = new IndexWriterConfig(this.analyzer);
        config.setOpenMode(IndexWriterConfig.OpenMode.CREATE_OR_APPEND);
        config.setSimilarity(new BM25Similarity());

        this.indexWriter = new IndexWriter(this.directory, config);
        this.indexWriter.commit();
        this.searcherManager = new SearcherManager(this.indexWriter, new SearcherFactory());
        log.info("Initialized embedded Apache Lucene index at {}", lucenePath);
    }

    /**
     * Indexes each page of the given PDF Document as a distinct Lucene document.
     */
    public synchronized void indexDocumentPages(Document doc, List<String> pageTexts) throws IOException {
        String docIdStr = doc.getId().toString();
        indexWriter.deleteDocuments(new Term(FIELD_DOC_ID, docIdStr));

        for (int i = 0; i < pageTexts.size(); i++) {
            int pageNumber = i + 1;
            String pageText = pageTexts.get(i) != null ? pageTexts.get(i) : "";
            if (pageText.isBlank()) {
                continue;
            }

            org.apache.lucene.document.Document luceneDoc = new org.apache.lucene.document.Document();
            luceneDoc.add(new StringField(FIELD_DOC_ID, docIdStr, Field.Store.YES));
            luceneDoc.add(new StringField(FIELD_REL_PATH, doc.getRelativePath(), Field.Store.YES));
            luceneDoc.add(new StoredField(FIELD_TITLE, doc.getFileName()));
            luceneDoc.add(new IntPoint(FIELD_PAGE_NUMBER, pageNumber));
            luceneDoc.add(new StoredField(FIELD_PAGE_NUMBER, pageNumber));
            luceneDoc.add(new Field(FIELD_CONTENT, pageText, CONTENT_FIELD_TYPE));
            luceneDoc.add(new StoredField(FIELD_PAGE_TEXT_STORED, pageText));

            indexWriter.addDocument(luceneDoc);
        }

        indexWriter.commit();
        searcherManager.maybeRefreshBlocking();
        log.debug("Indexed {} pages for document {} ({})", pageTexts.size(), doc.getFileName(), docIdStr);
    }

    /**
     * Purges all page documents belonging to the given PDF UUID from the Lucene index.
     */
    public synchronized void deleteDocument(UUID docId) throws IOException {
        indexWriter.deleteDocuments(new Term(FIELD_DOC_ID, docId.toString()));
        indexWriter.commit();
        searcherManager.maybeRefreshBlocking();
        log.info("Purged document {} from Lucene index", docId);
    }

    public SearcherManager getSearcherManager() {
        return searcherManager;
    }

    public Analyzer getAnalyzer() {
        return analyzer;
    }

    @PreDestroy
    public synchronized void close() {
        try {
            searcherManager.close();
            indexWriter.close();
            directory.close();
            analyzer.close();
        } catch (IOException e) {
            log.warn("Error closing Lucene resources: {}", e.getMessage());
        }
    }
}

