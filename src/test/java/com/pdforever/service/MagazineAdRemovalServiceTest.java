package com.pdforever.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import com.pdforever.dto.AdRemovalReportDto;
import com.pdforever.dto.AdRemovalRequest;
import com.pdforever.dto.PageAdAnalysisDto;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.service.rag.client.OllamaLlmClient;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.io.RandomAccessReadBufferedFile;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSession;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.net.Authenticator;
import java.net.CookieHandler;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.Flow;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MagazineAdRemovalServiceTest {

    @TempDir
    Path tempDir;

    private ObjectMapper objectMapper;
    private StubHttpClient stubHttpClient;
    private OllamaLlmClient ollamaLlmClient;
    private DocumentRepository documentRepository;
    private DirectoryScannerService scannerService;
    private StoragePathService storagePathService;
    private LibraryProperties libraryProperties;
    private MagazineAdRemovalService adRemovalService;

    private final Map<UUID, Document> docsById = new HashMap<>();
    private final Map<String, Document> docsByRelPath = new HashMap<>();

    @BeforeEach
    void setUp() throws IOException {
        objectMapper = new ObjectMapper();
        stubHttpClient = new StubHttpClient();
        ollamaLlmClient = new OllamaLlmClient(objectMapper, stubHttpClient);

        docsById.clear();
        docsByRelPath.clear();

        documentRepository = (DocumentRepository) Proxy.newProxyInstance(
                DocumentRepository.class.getClassLoader(),
                new Class<?>[]{DocumentRepository.class},
                (proxy, method, args) -> {
                    if ("findById".equals(method.getName()) && args != null && args.length == 1) {
                        return Optional.ofNullable(docsById.get((UUID) args[0]));
                    }
                    if ("findByRelativePath".equals(method.getName()) && args != null && args.length == 1) {
                        return Optional.ofNullable(docsByRelPath.get((String) args[0]));
                    }
                    throw new UnsupportedOperationException("Unexpected method: " + method.getName());
                }
        );

        Path rootDir = tempDir.resolve("storage");
        Path luceneDir = tempDir.resolve("lucene");
        Path coversDir = tempDir.resolve("covers");
        libraryProperties = new LibraryProperties(
                rootDir,
                luceneDir,
                coversDir,
                2000L,
                false,
                List.of(),
                List.of(),
                null,
                null
        );
        storagePathService = new StoragePathService(libraryProperties);
        storagePathService.ensureDirectoriesExist();

        scannerService = new DirectoryScannerService(
                libraryProperties,
                storagePathService,
                null,
                documentRepository,
                null,
                null,
                null,
                null,
                null,
                null,
                null
        ) {
            @Override
            public synchronized IngestionOutcome ingestOrUpdateFile(Path filePath, boolean commitImmediately, boolean force) {
                return IngestionOutcome.ADDED;
            }
        };

        adRemovalService = new MagazineAdRemovalService(
                libraryProperties,
                documentRepository,
                storagePathService,
                scannerService,
                ollamaLlmClient
        );
    }

    @Test
    void testDefaultSettingsAndStrictParameterValidation() {
        var resolved = adRemovalService.resolveAndValidateSettings(null);
        assertThat(resolved.ollamaUrl()).isEqualTo("http://127.0.0.1:11434");
        assertThat(resolved.model()).isEqualTo("qwen2.5vl");
        assertThat(resolved.minConfidence()).isEqualTo(0.75);
        assertThat(resolved.dpi()).isEqualTo(140);
        assertThat(resolved.dryRun()).isTrue();

        // Model name must never be silently rewritten
        var customModel = adRemovalService.resolveAndValidateSettings(
                new AdRemovalRequest("http://127.0.0.1:11434", "qwen2.5vl", 0.8, 150, false, null)
        );
        assertThat(customModel.model()).isEqualTo("qwen2.5vl");

        var customVariant = adRemovalService.resolveAndValidateSettings(
                new AdRemovalRequest(null, "custom-vlm-exact-name", 0.5, 100, true, null)
        );
        assertThat(customVariant.model()).isEqualTo("custom-vlm-exact-name");

        // Invalid minConfidence (< 0, > 1, NaN, Infinite)
        assertThatThrownBy(() -> adRemovalService.resolveAndValidateSettings(
                new AdRemovalRequest(null, "qwen2.5vl", -0.01, 140, true, null)
        )).isInstanceOf(ResponseStatusException.class);

        assertThatThrownBy(() -> adRemovalService.resolveAndValidateSettings(
                new AdRemovalRequest(null, "qwen2.5vl", 1.01, 140, true, null)
        )).isInstanceOf(ResponseStatusException.class);

        assertThatThrownBy(() -> adRemovalService.resolveAndValidateSettings(
                new AdRemovalRequest(null, "qwen2.5vl", Double.NaN, 140, true, null)
        )).isInstanceOf(ResponseStatusException.class);

        assertThatThrownBy(() -> adRemovalService.resolveAndValidateSettings(
                new AdRemovalRequest(null, "qwen2.5vl", Double.POSITIVE_INFINITY, 140, true, null)
        )).isInstanceOf(ResponseStatusException.class);

        // Invalid DPI (<= 0)
        assertThatThrownBy(() -> adRemovalService.resolveAndValidateSettings(
                new AdRemovalRequest(null, "qwen2.5vl", 0.75, 0, true, null)
        )).isInstanceOf(ResponseStatusException.class);

        assertThatThrownBy(() -> adRemovalService.resolveAndValidateSettings(
                new AdRemovalRequest(null, "qwen2.5vl", 0.75, -72, true, null)
        )).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void testStrictVlmResponseValidation() {
        // Valid response
        OllamaLlmClient.VlmAdDecision valid = ollamaLlmClient.validateAndParseVlmJson(
                "{\"is_ad\": true, \"confidence\": 0.88, \"reason\": \"Ganzseitige Produktanzeige für eine Armbanduhr.\"}"
        );
        assertThat(valid.isAd()).isTrue();
        assertThat(valid.confidence()).isEqualTo(0.88);
        assertThat(valid.reason()).isEqualTo("Ganzseitige Produktanzeige für eine Armbanduhr.");

        // Non-boolean is_ad must be rejected
        assertThatThrownBy(() -> ollamaLlmClient.validateAndParseVlmJson(
                "{\"is_ad\": \"true\", \"confidence\": 0.8, \"reason\": \"Test\"}"
        )).isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> ollamaLlmClient.validateAndParseVlmJson(
                "{\"is_ad\": 1, \"confidence\": 0.8, \"reason\": \"Test\"}"
        )).isInstanceOf(IllegalArgumentException.class);

        // Out-of-range or non-numeric confidence must be rejected
        assertThatThrownBy(() -> ollamaLlmClient.validateAndParseVlmJson(
                "{\"is_ad\": false, \"confidence\": 1.2, \"reason\": \"Test\"}"
        )).isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> ollamaLlmClient.validateAndParseVlmJson(
                "{\"is_ad\": false, \"confidence\": -0.1, \"reason\": \"Test\"}"
        )).isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> ollamaLlmClient.validateAndParseVlmJson(
                "{\"is_ad\": false, \"confidence\": \"0.75\", \"reason\": \"Test\"}"
        )).isInstanceOf(IllegalArgumentException.class);

        // Blank reason must be rejected
        assertThatThrownBy(() -> ollamaLlmClient.validateAndParseVlmJson(
                "{\"is_ad\": false, \"confidence\": 0.5, \"reason\": \"   \\t\\n  \"}"
        )).isInstanceOf(IllegalArgumentException.class);

        // Unexpected fields must be rejected
        assertThatThrownBy(() -> ollamaLlmClient.validateAndParseVlmJson(
                "{\"is_ad\": false, \"confidence\": 0.5, \"reason\": \"Artikel\", \"extra\": 123}"
        )).isInstanceOf(IllegalArgumentException.class);

        // Missing fields must be rejected
        assertThatThrownBy(() -> ollamaLlmClient.validateAndParseVlmJson(
                "{\"is_ad\": false, \"confidence\": 0.5}"
        )).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void testProtectionRulesCoverAndUnicodeWordBoundaries() {
        // Rule 1: Page 1 is always protected as cover, even with 2 words
        var coverEval = adRemovalService.evaluateProtection(1, "Magazin Titelblatt");
        assertThat(coverEval.isCover()).isTrue();
        assertThat(coverEval.protectedPage()).isTrue();

        // Rule 2: Page > 1 with standalone keyword ("Inhaltsverzeichnis", "Inhalt", "Impressum", "Editorial") and > 40 words
        String fortyWords = "Wort ".repeat(40).strip();
        var notEnoughWords = adRemovalService.evaluateProtection(2, "Inhaltsverzeichnis " + "Wort ".repeat(39).strip());
        assertThat(notEnoughWords.wordCount()).isEqualTo(40);
        assertThat(notEnoughWords.matchedProtectedTerms()).containsExactly("inhaltsverzeichnis");
        assertThat(notEnoughWords.protectedPage()).isFalse(); // Exactly 40 words is not > 40

        var protected41Words = adRemovalService.evaluateProtection(2, "IMPRESSUM " + fortyWords);
        assertThat(protected41Words.wordCount()).isEqualTo(41);
        assertThat(protected41Words.matchedProtectedTerms()).containsExactly("impressum");
        assertThat(protected41Words.protectedPage()).isTrue();

        // Substrings inside compound words must NOT trigger protection
        var compoundWordsOnly = adRemovalService.evaluateProtection(
                3,
                "Inhalte Hauptinhalt Inhaltsstoffe Redaktionsimpressum Editorialteam " + fortyWords
        );
        assertThat(compoundWordsOnly.wordCount()).isEqualTo(45);
        assertThat(compoundWordsOnly.matchedProtectedTerms()).isEmpty();
        assertThat(compoundWordsOnly.protectedPage()).isFalse();
    }

    @Test
    void testFullVlmAllPagesAnalysisDryRunAndCleanedPdfCreation() throws Exception {
        String[] vlmReplies = new String[]{
                "{\"is_ad\": true, \"confidence\": 0.99, \"reason\": \"Sieht wie ein Marken-Cover aus.\"}",
                "{\"is_ad\": true, \"confidence\": 0.95, \"reason\": \"Fälschlich als Anzeige eingestuft.\"}",
                "{\"is_ad\": true, \"confidence\": 0.91, \"reason\": \"Ganzseitige Produktanzeige für ein Auto.\"}",
                "{\"is_ad\": true, \"confidence\": 0.60, \"reason\": \"Unsichere Anzeige mit wenig Kontrast.\"}",
                "{\"is_ad\": true, \"confidence\": 0.99, \"reason\": \"Ungültig\", \"unexpected_field\": true}"
        };

        AtomicInteger callCounter = new AtomicInteger(0);
        List<JsonNode> capturedRequests = new ArrayList<>();

        stubHttpClient.setHandler(req -> {
            try {
                String bodyStr = extractRequestBody(req);
                JsonNode reqJson = objectMapper.readTree(bodyStr);
                capturedRequests.add(reqJson);

                int idx = callCounter.getAndIncrement() % vlmReplies.length;
                String content = vlmReplies[idx];
                return objectMapper.writeValueAsString(
                        Map.of(
                                "model", reqJson.path("model").asText(),
                                "message", Map.of("role", "assistant", "content", content),
                                "done", true
                        )
                );
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });

        Path magazinesDir = libraryProperties.rootDir().resolve("Magazines");
        Files.createDirectories(magazinesDir);
        Path magazinePdf = magazinesDir.resolve("Test_Magazin_01_2025.pdf");

        String editorialPageText = "Editorial Liebe Leserinnen und Leser willkommen zur neuen Ausgabe mit spannenden Themen aus Wissenschaft Technik Kultur Gesellschaft Politik Wirtschaft Natur Geschichte Forschung Zukunft Innovation Alltag "
                + "Wort ".repeat(30);

        createTestMagazinePdf(magazinePdf, List.of(
                "Magazin Cover Ausgabe Januar 2025",
                editorialPageText,
                "ANZEIGE Neue Sportwagen Generation Jetzt Probe fahren",
                "ANZEIGE Werbung Sonderangebot",
                "Redaktioneller Artikel über erneuerbare Energien mit viel Text"
        ));

        UUID origId = UUID.randomUUID();
        Document originalDoc = new Document();
        originalDoc.setId(origId);
        originalDoc.setFileName("Test_Magazin_01_2025.pdf");
        originalDoc.setRelativePath("Magazines/Test_Magazin_01_2025.pdf");
        originalDoc.setFormat("PDF");
        originalDoc.setPageCount(5);
        originalDoc.setDeleted(false);
        docsById.put(origId, originalDoc);
        docsByRelPath.put(originalDoc.getRelativePath(), originalDoc);

        UUID cleanedId = UUID.randomUUID();
        Document cleanedDoc = new Document();
        cleanedDoc.setId(cleanedId);
        cleanedDoc.setFileName("Test_Magazin_01_2025_bereinigt.pdf");
        cleanedDoc.setRelativePath("Magazines/Test_Magazin_01_2025_bereinigt.pdf");
        cleanedDoc.setFormat("PDF");
        cleanedDoc.setPageCount(4);
        docsById.put(cleanedId, cleanedDoc);
        docsByRelPath.put(cleanedDoc.getRelativePath(), cleanedDoc);

        // 1. Run Dry-Run (dryRun = true)
        AdRemovalRequest dryRunReq = new AdRemovalRequest(
                "http://127.0.0.1:11434",
                "qwen2.5vl",
                0.75,
                140,
                true,
                null
        );
        AdRemovalReportDto dryReport = adRemovalService.analyzeAndCleanDocument(origId, dryRunReq);

        // Every single page (all 5) must have been rendered as PNG in memory and sent to Ollama
        assertThat(capturedRequests).hasSize(5);
        for (JsonNode req : capturedRequests) {
            assertThat(req.path("model").asText()).isEqualTo("qwen2.5vl");
            assertThat(req.path("options").path("temperature").asInt()).isEqualTo(0);
            assertThat(req.path("options").path("seed").asInt()).isEqualTo(0);
            assertThat(req.path("format").path("additionalProperties").asBoolean()).isFalse();

            String b64Img = req.path("messages").get(0).path("images").get(0).asText();
            byte[] pngBytes = Base64.getDecoder().decode(b64Img);
            BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(pngBytes));
            assertThat(decoded).isNotNull();
            assertThat(decoded.getWidth()).isGreaterThan(100);
        }

        assertThat(dryReport.totalPages()).isEqualTo(5);
        assertThat(dryReport.protectedPagesCount()).isEqualTo(2);
        assertThat(dryReport.removedPagesCount()).isEqualTo(1);
        assertThat(dryReport.keptPagesCount()).isEqualTo(4);
        assertThat(dryReport.errorCount()).isEqualTo(1);
        assertThat(dryReport.pagesMarkedForRemoval()).containsExactly(3);
        assertThat(dryReport.cleanedDocumentId()).isNull();

        PageAdAnalysisDto p1 = dryReport.pages().get(0);
        assertThat(p1.isCover()).isTrue();
        assertThat(p1.protectedPage()).isTrue();
        assertThat(p1.vlmIsAd()).isTrue();
        assertThat(p1.markedForRemoval()).isFalse();

        PageAdAnalysisDto p2 = dryReport.pages().get(1);
        assertThat(p2.protectedPage()).isTrue();
        assertThat(p2.matchedProtectedTerms()).contains("editorial");
        assertThat(p2.vlmIsAd()).isTrue();
        assertThat(p2.markedForRemoval()).isFalse();

        PageAdAnalysisDto p3 = dryReport.pages().get(2);
        assertThat(p3.protectedPage()).isFalse();
        assertThat(p3.vlmIsAd()).isTrue();
        assertThat(p3.markedForRemoval()).isTrue();

        PageAdAnalysisDto p4 = dryReport.pages().get(3);
        assertThat(p4.protectedPage()).isFalse();
        assertThat(p4.vlmIsAd()).isTrue();
        assertThat(p4.vlmConfidence()).isEqualTo(0.60);
        assertThat(p4.markedForRemoval()).isFalse();

        PageAdAnalysisDto p5 = dryReport.pages().get(4);
        assertThat(p5.vlmError()).isNotBlank();
        assertThat(p5.markedForRemoval()).isFalse();

        // 2. Run Cleanup (dryRun = false)
        AdRemovalRequest cleanReq = new AdRemovalRequest(
                "http://127.0.0.1:11434",
                "qwen2.5vl",
                0.75,
                140,
                false,
                null
        );
        AdRemovalReportDto cleanReport = adRemovalService.analyzeAndCleanDocument(origId, cleanReq);

        assertThat(cleanReport.cleanedDocumentId()).isEqualTo(cleanedId);
        assertThat(cleanReport.cleanedRelativePath()).isEqualTo("Magazines/Test_Magazin_01_2025_bereinigt.pdf");
        assertThat(cleanReport.logRelativePath()).isEqualTo("Magazines/Test_Magazin_01_2025.log");

        // Log file with the same name as the PDF file and .log extension must exist and contain both the run and the result
        Path logFilePath = magazinesDir.resolve("Test_Magazin_01_2025.log");
        assertThat(Files.exists(logFilePath)).isTrue();
        String logContent = Files.readString(logFilePath, StandardCharsets.UTF_8);
        assertThat(logContent)
                .contains("PDForever — Werbeanzeigen-Erkennung & Bereinigung (VLM-Lauf)")
                .contains("Quelldatei        : Magazines/Test_Magazin_01_2025.pdf")
                .contains("Seite 1/5")
                .contains("Seite 2/5")
                .contains("Seite 3/5")
                .contains("Seite 4/5")
                .contains("Seite 5/5")
                .contains("ENTFERNEN (Werbung erkannt)")
                .contains("ERGEBNIS DES LAUFS")
                .contains("Magazines/Test_Magazin_01_2025_bereinigt.pdf");

        // Original PDF must still have 5 pages
        try (var rar = new RandomAccessReadBufferedFile(magazinePdf);
             PDDocument origLoaded = Loader.loadPDF(rar)) {
            assertThat(origLoaded.getNumberOfPages()).isEqualTo(5);
        }

        // New cleaned PDF must exist and have 4 pages
        Path cleanedPdfPath = magazinesDir.resolve("Test_Magazin_01_2025_bereinigt.pdf");
        assertThat(Files.exists(cleanedPdfPath)).isTrue();
        try (var rar = new RandomAccessReadBufferedFile(cleanedPdfPath);
             PDDocument cleanLoaded = Loader.loadPDF(rar)) {
            assertThat(cleanLoaded.getNumberOfPages()).isEqualTo(4);
        }
    }

    private String extractRequestBody(HttpRequest request) {
        StringBuilder sb = new StringBuilder();
        request.bodyPublisher().ifPresent(publisher -> publisher.subscribe(new Flow.Subscriber<ByteBuffer>() {
            @Override
            public void onSubscribe(Flow.Subscription subscription) {
                subscription.request(Long.MAX_VALUE);
            }

            @Override
            public void onNext(ByteBuffer item) {
                byte[] bytes = new byte[item.remaining()];
                item.get(bytes);
                sb.append(new String(bytes, StandardCharsets.UTF_8));
            }

            @Override
            public void onError(Throwable throwable) {
            }

            @Override
            public void onComplete() {
            }
        }));
        return sb.toString();
    }

    private void createTestMagazinePdf(Path target, List<String> pageContents) throws IOException {
        try (PDDocument doc = new PDDocument()) {
            PDType1Font font = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
            for (String text : pageContents) {
                PDPage page = new PDPage();
                doc.addPage(page);
                try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                    cs.beginText();
                    cs.setFont(font, 11);
                    cs.newLineAtOffset(40, 700);
                    List<String> lines = new ArrayList<>();
                    String[] words = text.split("\\s+");
                    StringBuilder line = new StringBuilder();
                    for (String w : words) {
                        if (line.length() + w.length() > 70) {
                            lines.add(line.toString());
                            line.setLength(0);
                        }
                        if (!line.isEmpty()) line.append(" ");
                        line.append(w);
                    }
                    if (!line.isEmpty()) lines.add(line.toString());

                    for (String l : lines) {
                        cs.showText(l);
                        cs.newLineAtOffset(0, -16);
                    }
                    cs.endText();
                }
            }
            doc.save(target.toFile());
        }
    }

    private static class StubHttpClient extends HttpClient {
        private Function<HttpRequest, String> handler = req -> "{}";

        public void setHandler(Function<HttpRequest, String> handler) {
            this.handler = handler;
        }

        @Override
        @SuppressWarnings("unchecked")
        public <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> responseBodyHandler) {
            String body = handler.apply(request);
            return (HttpResponse<T>) new HttpResponse<String>() {
                @Override
                public int statusCode() {
                    return 200;
                }

                @Override
                public HttpRequest request() {
                    return request;
                }

                @Override
                public Optional<HttpResponse<String>> previousResponse() {
                    return Optional.empty();
                }

                @Override
                public HttpHeaders headers() {
                    return HttpHeaders.of(Map.of(), (k, v) -> true);
                }

                @Override
                public String body() {
                    return body;
                }

                @Override
                public Optional<SSLSession> sslSession() {
                    return Optional.empty();
                }

                @Override
                public URI uri() {
                    return request.uri();
                }

                @Override
                public Version version() {
                    return Version.HTTP_1_1;
                }
            };
        }

        @Override
        public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest request, HttpResponse.BodyHandler<T> responseBodyHandler) {
            return CompletableFuture.completedFuture(send(request, responseBodyHandler));
        }

        @Override
        public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest request, HttpResponse.BodyHandler<T> responseBodyHandler, HttpResponse.PushPromiseHandler<T> pushPromiseHandler) {
            return CompletableFuture.completedFuture(send(request, responseBodyHandler));
        }

        @Override
        public Optional<CookieHandler> cookieHandler() {
            return Optional.empty();
        }

        @Override
        public Optional<Duration> connectTimeout() {
            return Optional.empty();
        }

        @Override
        public Redirect followRedirects() {
            return Redirect.NEVER;
        }

        @Override
        public Optional<ProxySelector> proxy() {
            return Optional.empty();
        }

        @Override
        public SSLContext sslContext() {
            return null;
        }

        @Override
        public SSLParameters sslParameters() {
            return null;
        }

        @Override
        public Optional<Authenticator> authenticator() {
            return Optional.empty();
        }

        @Override
        public Version version() {
            return Version.HTTP_1_1;
        }

        @Override
        public Optional<Executor> executor() {
            return Optional.empty();
        }
    }
}
