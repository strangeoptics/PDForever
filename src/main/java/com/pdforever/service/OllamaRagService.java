package com.pdforever.service;

import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import com.pdforever.dto.DocumentFilterCriteria;
import com.pdforever.dto.OllamaStatusDto;
import com.pdforever.dto.RagPassageDto;
import com.pdforever.dto.RagQueryRequest;
import com.pdforever.dto.RagResponseDto;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.service.rag.client.LlmClient;
import com.pdforever.service.rag.client.LlmRequest;
import com.pdforever.service.rag.client.LlmResponse;
import org.apache.lucene.index.Term;
import org.apache.lucene.queryparser.classic.ParseException;
import org.apache.lucene.queryparser.classic.QueryParser;
import org.apache.lucene.search.*;
import org.apache.lucene.search.similarities.BM25Similarity;
import org.apache.lucene.util.BytesRef;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.function.Consumer;

import static com.pdforever.service.LuceneIndexService.*;

@Service
public class OllamaRagService {

    private static final Logger log = LoggerFactory.getLogger(OllamaRagService.class);

    private final LibraryProperties properties;
    private final LuceneIndexService luceneIndexService;
    private final DocumentRepository documentRepository;
    private final LibraryManagementService libraryManagementService;
    private final FileNameCleaner fileNameCleaner;
    private final List<LlmClient> llmClients;

    public OllamaRagService(
            LibraryProperties properties,
            LuceneIndexService luceneIndexService,
            DocumentRepository documentRepository,
            LibraryManagementService libraryManagementService,
            FileNameCleaner fileNameCleaner,
            List<LlmClient> llmClients
    ) {
        this.properties = properties;
        this.luceneIndexService = luceneIndexService;
        this.documentRepository = documentRepository;
        this.libraryManagementService = libraryManagementService;
        this.fileNameCleaner = fileNameCleaner;
        this.llmClients = llmClients != null ? llmClients : List.of();
    }

    public LlmClient resolveLlmClient() {
        String configuredProvider = (properties.rag() != null && properties.rag().provider() != null)
                ? properties.rag().provider().toLowerCase(Locale.ROOT).strip()
                : "ollama";

        for (LlmClient client : llmClients) {
            if (client.getProviderType().equalsIgnoreCase(configuredProvider)) {
                return client;
            }
        }
        if (configuredProvider.contains("openai") || configuredProvider.contains("vllm")
                || configuredProvider.contains("localai") || configuredProvider.contains("llama")) {
            for (LlmClient client : llmClients) {
                if ("openai".equalsIgnoreCase(client.getProviderType())) {
                    return client;
                }
            }
        }
        return llmClients.stream()
                .filter(c -> "ollama".equalsIgnoreCase(c.getProviderType()))
                .findFirst()
                .orElseGet(() -> !llmClients.isEmpty() ? llmClients.get(0) : null);
    }

    public OllamaStatusDto checkOllamaStatus(String customOllamaUrl) {
        String url = resolveOllamaUrl(customOllamaUrl);
        boolean enabled = properties.rag() != null && properties.rag().enabled();
        String currentModel = resolveModel(null);

        LlmClient client = resolveLlmClient();
        if (client != null) {
            return client.checkStatus(url, currentModel, enabled);
        }

        return new OllamaStatusDto(
                enabled,
                false,
                url,
                currentModel,
                Collections.emptyList(),
                "Kein LLM-Provider konfiguriert."
        );
    }

    public RagResponseDto ask(RagQueryRequest request) {
        String query = request.query() != null ? request.query().strip() : "";
        if (query.isEmpty()) {
            return new RagResponseDto(
                    "Bitte geben Sie eine Frage ein.",
                    Collections.emptyList(),
                    resolveModel(request.model()),
                    true,
                    null
            );
        }

        int maxPassages = properties.rag() != null ? properties.rag().maxPassages() : 6;
        List<RagPassageDto> passages = retrievePassages(query, request.documentId(), request.criteria(), maxPassages);

        if (passages.isEmpty()) {
            return new RagResponseDto(
                    "In den ausgewählten Dokumenten wurden keine relevanten Passagen zur Frage gefunden.",
                    Collections.emptyList(),
                    resolveModel(request.model()),
                    true,
                    null
            );
        }

        String model = resolveModel(request.model());
        String url = resolveOllamaUrl(null);
        String prompt = buildRagPrompt(query, passages, request.documentId() != null);
        String apiKey = properties.rag() != null ? properties.rag().apiKey() : null;

        LlmClient client = resolveLlmClient();
        if (client == null) {
            return new RagResponseDto(
                    null,
                    passages,
                    model,
                    false,
                    "Kein LLM-Client verfügbar."
            );
        }

        LlmRequest llmReq = new LlmRequest(url, model, prompt, 0.1, 0.9, apiKey);
        LlmResponse llmRes = client.generate(llmReq);
        if (llmRes.success()) {
            return new RagResponseDto(llmRes.text(), passages, model, true, null);
        } else {
            return new RagResponseDto(null, passages, model, false, llmRes.errorMessage());
        }
    }

    public void streamAsk(
            RagQueryRequest request,
            Consumer<List<RagPassageDto>> passagesConsumer,
            Consumer<String> tokenConsumer,
            Consumer<String> errorConsumer,
            Runnable doneCallback
    ) {
        String query = request.query() != null ? request.query().strip() : "";
        if (query.isEmpty()) {
            tokenConsumer.accept("Bitte geben Sie eine Frage ein.");
            doneCallback.run();
            return;
        }

        int maxPassages = properties.rag() != null ? properties.rag().maxPassages() : 6;
        List<RagPassageDto> passages = retrievePassages(query, request.documentId(), request.criteria(), maxPassages);
        passagesConsumer.accept(passages);

        if (passages.isEmpty()) {
            tokenConsumer.accept("In den ausgewählten Dokumenten wurden keine relevanten Passagen zur Frage gefunden.");
            doneCallback.run();
            return;
        }

        String model = resolveModel(request.model());
        String url = resolveOllamaUrl(null);
        String prompt = buildRagPrompt(query, passages, request.documentId() != null);
        String apiKey = properties.rag() != null ? properties.rag().apiKey() : null;

        LlmClient client = resolveLlmClient();
        if (client == null) {
            errorConsumer.accept("Kein LLM-Client verfügbar.");
            doneCallback.run();
            return;
        }

        LlmRequest llmReq = new LlmRequest(url, model, prompt, 0.1, 0.9, apiKey);
        client.streamGenerate(llmReq, tokenConsumer, errorConsumer, doneCallback);
    }

    public List<RagPassageDto> retrievePassages(
            String rawQuery,
            UUID documentId,
            DocumentFilterCriteria criteria,
            int maxPassages
    ) {
        SearcherManager searcherManager = luceneIndexService.getSearcherManager();
        IndexSearcher searcher = null;
        try {
            searcherManager.maybeRefresh();
            searcher = searcherManager.acquire();
            searcher.setSimilarity(new BM25Similarity());

            BooleanQuery.Builder mainQueryBuilder = new BooleanQuery.Builder();

            // 1. Text Query over page content
            Query textQuery = buildTextQuery(rawQuery.strip());
            mainQueryBuilder.add(textQuery, BooleanClause.Occur.MUST);

            // 2. Scope Filter: either single document or faceted library criteria
            if (documentId != null) {
                mainQueryBuilder.add(new TermQuery(new Term(FIELD_DOC_ID, documentId.toString())), BooleanClause.Occur.FILTER);
            } else if (criteria != null && criteria.hasAnyFilter()) {
                Set<UUID> allowedIds = libraryManagementService.findMatchingDocumentIds(criteria);
                if (allowedIds.isEmpty()) {
                    return Collections.emptyList();
                }
                List<BytesRef> terms = allowedIds.stream().map(id -> new BytesRef(id.toString())).toList();
                mainQueryBuilder.add(new TermInSetQuery(FIELD_DOC_ID, terms), BooleanClause.Occur.FILTER);
            }

            TopDocs topDocs = searcher.search(mainQueryBuilder.build(), Math.max(1, maxPassages));

            // If question was generic like "Worum geht es?" and documentId is given, fall back to first pages
            if (topDocs.scoreDocs.length == 0 && documentId != null) {
                Query docScopeQuery = new TermQuery(new Term(FIELD_DOC_ID, documentId.toString()));
                topDocs = searcher.search(docScopeQuery, Math.min(3, maxPassages));
            }

            if (topDocs.scoreDocs.length == 0) {
                return Collections.emptyList();
            }

            Map<UUID, Document> docEntityCache = new HashMap<>();
            List<RagPassageDto> results = new ArrayList<>();

            for (ScoreDoc scoreDoc : topDocs.scoreDocs) {
                org.apache.lucene.document.Document luceneDoc = searcher.storedFields().document(
                        scoreDoc.doc,
                        Set.of(FIELD_DOC_ID, FIELD_REL_PATH, FIELD_TITLE, FIELD_PAGE_NUMBER, FIELD_PAGE_TEXT_STORED)
                );

                String docIdStr = luceneDoc.get(FIELD_DOC_ID);
                if (docIdStr == null) continue;
                UUID docId = UUID.fromString(docIdStr);

                Document entity = docEntityCache.computeIfAbsent(docId, id -> documentRepository.findById(id).orElse(null));
                String title = entity != null && entity.getMetaTitle() != null && !entity.getMetaTitle().isBlank()
                        ? entity.getMetaTitle()
                        : fileNameCleaner.cleanFileName(luceneDoc.get(FIELD_TITLE));

                String relPath = luceneDoc.get(FIELD_REL_PATH);
                int pageNum = luceneDoc.getField(FIELD_PAGE_NUMBER).numericValue().intValue();
                String storedText = luceneDoc.get(FIELD_PAGE_TEXT_STORED);
                String cleanText = storedText != null ? storedText.replaceAll("\\s+", " ").strip() : "";

                // Trim to ~1800 chars per page so context window stays fast and dense
                int maxLen = Math.min(cleanText.length(), 1800);
                String trimmedText = cleanText.substring(0, maxLen) + (cleanText.length() > maxLen ? " …" : "");

                results.add(new RagPassageDto(docId, title, relPath, pageNum, trimmedText, scoreDoc.score));
            }

            return results;
        } catch (Exception e) {
            log.error("Failed Lucene retrieval for RAG query '{}': {}", rawQuery, e.getMessage(), e);
            return Collections.emptyList();
        } finally {
            if (searcher != null) {
                try {
                    searcherManager.release(searcher);
                } catch (Exception ignored) {
                }
            }
        }
    }

    private Query buildTextQuery(String cleanQuery) {
        QueryParser parser = new QueryParser(FIELD_CONTENT, luceneIndexService.getAnalyzer());
        parser.setDefaultOperator(QueryParser.Operator.OR);

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

        String[] tokens = cleanQuery.toLowerCase(Locale.ROOT).split("\\s+");
        for (String t : tokens) {
            String sanitized = t.replaceAll("[^\\p{L}\\p{N}]", "");
            if (sanitized.length() >= 3) {
                builder.add(new TermQuery(new Term(FIELD_CONTENT, sanitized)), BooleanClause.Occur.SHOULD);
            }
        }

        return builder.build();
    }

    private String buildRagPrompt(String query, List<RagPassageDto> passages, boolean singleDocument) {
        StringBuilder sb = new StringBuilder();
        sb.append("Du bist ein präziser, wissenschaftlicher Lese- und Wissensassistent für eine persönliche PDF-Bibliothek.\n");
        sb.append("Deine Aufgabe ist es, Fragen STRENG auf Basis der folgenden Auszüge aus den PDF-Dokumenten zu beantworten.\n\n");
        sb.append("REGELN:\n");
        sb.append("1. Antworte auf Deutsch (außer der Quelltext ist auf Englisch und Fachtermini sind nötig).\n");
        if (singleDocument) {
            sb.append("2. Belege jede Kernaussage mit der genauen Seitenzahl im Format [S. X] (z. B. [S. 4] oder [S. 12-13]).\n");
        } else {
            sb.append("2. Belege jede Kernaussage mit Dokumenttitel und Seitenzahl im Format [Titel, S. X] (z. B. [Quantum Paper, S. 4]).\n");
        }
        sb.append("3. Wenn die Auszüge die Frage nicht oder nur unvollständig beantworten, stelle dies klar heraus. Erfinde KEINE Fakten.\n");
        sb.append("4. Fasse prägnant, strukturiert und informativ zusammen.\n\n");

        sb.append("=== AUSZÜGE AUS DEN DOKUMENTEN ===\n\n");
        int idx = 1;
        for (RagPassageDto p : passages) {
            sb.append("--- AUSZUG ").append(idx++).append(" [Dokument: \"").append(p.documentTitle())
                    .append("\", Seite ").append(p.pageNumber()).append("] ---\n");
            sb.append(p.passageText()).append("\n\n");
        }

        sb.append("=== BENUTZERFRAGE ===\n");
        sb.append(query).append("\n\n");
        sb.append("ANTWORT (mit Belegen [S. X]):\n");

        return sb.toString();
    }

    private String resolveOllamaUrl(String customUrl) {
        if (customUrl != null && !customUrl.isBlank()) {
            return customUrl.replaceAll("/+$", "");
        }
        if (properties.rag() != null && properties.rag().ollamaUrl() != null && !properties.rag().ollamaUrl().isBlank()) {
            return properties.rag().ollamaUrl().replaceAll("/+$", "");
        }
        return "http://localhost:11434";
    }

    private String resolveModel(String customModel) {
        if (customModel != null && !customModel.isBlank()) {
            return customModel.strip();
        }
        if (properties.rag() != null && properties.rag().model() != null && !properties.rag().model().isBlank()) {
            return properties.rag().model().strip();
        }
        return "qwen2.5:14b";
    }
}

