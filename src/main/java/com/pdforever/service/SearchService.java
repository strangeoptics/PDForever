package com.pdforever.service;

import com.pdforever.dto.SearchResultGroupDto;
import com.pdforever.dto.SearchResultGroupDto.PageMatchDto;
import org.apache.lucene.document.Document;
import org.apache.lucene.index.Term;
import org.apache.lucene.queryparser.classic.ParseException;
import org.apache.lucene.queryparser.classic.QueryParser;
import org.apache.lucene.search.*;
import org.apache.lucene.search.similarities.BM25Similarity;
import org.apache.lucene.search.uhighlight.DefaultPassageFormatter;
import org.apache.lucene.search.uhighlight.UnifiedHighlighter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;

import static com.pdforever.service.LuceneIndexService.*;

@Service
public class SearchService {

    private static final Logger log = LoggerFactory.getLogger(SearchService.class);
    private static final int MAX_PAGE_HITS = 100;

    private final LuceneIndexService luceneIndexService;
    private final FileNameCleaner fileNameCleaner;

    public SearchService(LuceneIndexService luceneIndexService, FileNameCleaner fileNameCleaner) {
        this.luceneIndexService = luceneIndexService;
        this.fileNameCleaner = fileNameCleaner;
    }

    public List<SearchResultGroupDto> search(String rawQuery) {
        if (rawQuery == null || rawQuery.isBlank()) {
            return Collections.emptyList();
        }

        SearcherManager searcherManager = luceneIndexService.getSearcherManager();
        IndexSearcher searcher = null;
        try {
            searcherManager.maybeRefresh();
            searcher = searcherManager.acquire();
            searcher.setSimilarity(new BM25Similarity());

            Query query = buildQuery(rawQuery.strip());
            TopDocs topDocs = searcher.search(query, MAX_PAGE_HITS);
            if (topDocs.scoreDocs.length == 0) {
                return Collections.emptyList();
            }

            UnifiedHighlighter highlighter = createHighlighter(searcher);
            String[] snippets = highlighter.highlight(FIELD_CONTENT, query, topDocs, 2);

            Map<UUID, GroupAccumulator> grouped = new LinkedHashMap<>();

            for (int i = 0; i < topDocs.scoreDocs.length; i++) {
                ScoreDoc scoreDoc = topDocs.scoreDocs[i];
                Document luceneDoc = searcher.storedFields().document(
                        scoreDoc.doc,
                        Set.of(FIELD_DOC_ID, FIELD_REL_PATH, FIELD_TITLE, FIELD_PAGE_NUMBER, FIELD_PAGE_TEXT_STORED)
                );

                String docIdStr = luceneDoc.get(FIELD_DOC_ID);
                if (docIdStr == null) continue;
                UUID docId = UUID.fromString(docIdStr);

                String relPath = luceneDoc.get(FIELD_REL_PATH);
                String rawTitle = luceneDoc.get(FIELD_TITLE);
                if (rawTitle == null && relPath != null) {
                    int idx = relPath.lastIndexOf('/');
                    rawTitle = idx >= 0 ? relPath.substring(idx + 1) : relPath;
                }
                final String resolvedTitle = fileNameCleaner.cleanFileName(rawTitle);
                int pageNumber = luceneDoc.getField(FIELD_PAGE_NUMBER).numericValue().intValue();

                String snippet = (snippets != null && i < snippets.length && snippets[i] != null && !snippets[i].isBlank())
                        ? snippets[i]
                        : buildFallbackSnippet(luceneDoc.get(FIELD_PAGE_TEXT_STORED), rawQuery);

                GroupAccumulator acc = grouped.computeIfAbsent(
                        docId,
                        id -> new GroupAccumulator(id, resolvedTitle, relPath)
                );
                acc.matches.add(new PageMatchDto(pageNumber, snippet, scoreDoc.score));
            }

            return grouped.values().stream()
                    .map(acc -> {
                        List<PageMatchDto> sortedMatches = acc.matches.stream()
                                .sorted(Comparator.comparingInt(PageMatchDto::pageNumber))
                                .toList();
                        return new SearchResultGroupDto(acc.docId, acc.title, acc.relPath, sortedMatches);
                    })
                    .toList();

        } catch (IOException e) {
            log.error("Lucene search error for query '{}': {}", rawQuery, e.getMessage(), e);
            return Collections.emptyList();
        } finally {
            if (searcher != null) {
                try {
                    searcherManager.release(searcher);
                } catch (IOException ignored) {
                }
            }
        }
    }

    private Query buildQuery(String cleanQuery) {
        QueryParser parser = new QueryParser(FIELD_CONTENT, luceneIndexService.getAnalyzer());
        parser.setDefaultOperator(QueryParser.Operator.AND);

        Query parsedQuery;
        try {
            parsedQuery = parser.parse(cleanQuery);
        } catch (ParseException e) {
            try {
                parsedQuery = parser.parse(QueryParser.escape(cleanQuery));
            } catch (ParseException ex) {
                parsedQuery = new TermQuery(new Term(FIELD_CONTENT, cleanQuery.toLowerCase(Locale.ROOT)));
            }
        }

        BooleanQuery.Builder builder = new BooleanQuery.Builder();
        builder.add(new BoostQuery(parsedQuery, 2.0f), BooleanClause.Occur.SHOULD);

        // Add prefix query on the last token to support instant-search / type-ahead matching
        String[] tokens = cleanQuery.toLowerCase(Locale.ROOT).split("\\s+");
        if (tokens.length > 0) {
            String lastToken = tokens[tokens.length - 1].replaceAll("[^\\p{L}\\p{N}]", "");
            if (lastToken.length() >= 2) {
                builder.add(new PrefixQuery(new Term(FIELD_CONTENT, lastToken)), BooleanClause.Occur.SHOULD);
            }
        }

        return builder.build();
    }

    private UnifiedHighlighter createHighlighter(IndexSearcher searcher) {
        UnifiedHighlighter.Builder builder = new UnifiedHighlighter.Builder(searcher, luceneIndexService.getAnalyzer())
                .withFormatter(new DefaultPassageFormatter("<mark>", "</mark>", " … ", false))
                .withMaxLength(1_000_000);

        return new UnifiedHighlighter(builder) {
            @Override
            protected List<CharSequence[]> loadFieldValues(
                    String[] fields,
                    DocIdSetIterator docIter,
                    int cacheCharsThreshold
            ) throws IOException {
                String[] mappedFields = Arrays.stream(fields)
                        .map(f -> FIELD_CONTENT.equals(f) ? FIELD_PAGE_TEXT_STORED : f)
                        .toArray(String[]::new);
                return super.loadFieldValues(mappedFields, docIter, cacheCharsThreshold);
            }
        };
    }

    private String buildFallbackSnippet(String pageText, String query) {
        if (pageText == null || pageText.isBlank()) {
            return "";
        }
        String normalized = pageText.replaceAll("\\s+", " ").strip();
        int maxLen = Math.min(normalized.length(), 220);
        return normalized.substring(0, maxLen) + (normalized.length() > maxLen ? " …" : "");
    }

    private static class GroupAccumulator {
        final UUID docId;
        final String title;
        final String relPath;
        final List<PageMatchDto> matches = new ArrayList<>();

        GroupAccumulator(UUID docId, String title, String relPath) {
            this.docId = docId;
            this.title = title;
            this.relPath = relPath;
        }
    }
}

