package com.pdforever.service;

import com.pdforever.config.LibraryProperties;
import com.pdforever.domain.Document;
import com.pdforever.dto.AdRemovalReportDto;
import com.pdforever.dto.AdRemovalRequest;
import com.pdforever.dto.ApplyAdRemovalRequest;
import com.pdforever.dto.PageAdAnalysisDto;
import com.pdforever.repository.DocumentRepository;
import com.pdforever.service.rag.client.OllamaLlmClient;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.io.RandomAccessReadBufferedFile;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class MagazineAdRemovalService {

    private static final Logger log = LoggerFactory.getLogger(MagazineAdRemovalService.class);

    public static final int MIN_WORDS_FOR_KEYWORD_PROTECTION = 41; // "mehr als 40 Wörter" (> 40)
    private static final DateTimeFormatter LOG_TS_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /**
     * Unicode-aware standalone word matching for protected editorial/index terms:
     * inhaltsverzeichnis, inhalt, impressum, editorial.
     */
    private static final Pattern PROTECTED_TERMS_PATTERN = Pattern.compile(
            "\\b(inhaltsverzeichnis|inhalt|impressum|editorial)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE | Pattern.UNICODE_CHARACTER_CLASS
    );

    /**
     * Unicode-aware word boundary pattern for counting words on a page.
     */
    private static final Pattern UNICODE_WORD_PATTERN = Pattern.compile(
            "\\b\\w+\\b",
            Pattern.UNICODE_CHARACTER_CLASS
    );

    private final LibraryProperties properties;
    private final DocumentRepository documentRepository;
    private final StoragePathService storagePathService;
    private final DirectoryScannerService scannerService;
    private final OllamaLlmClient ollamaLlmClient;

    public record ResolvedAdRemovalSettings(
            String ollamaUrl,
            String model,
            double minConfidence,
            int dpi,
            boolean dryRun,
            String outputFileName,
            boolean includeReason
    ) {
        public ResolvedAdRemovalSettings(
                String ollamaUrl,
                String model,
                double minConfidence,
                int dpi,
                boolean dryRun,
                String outputFileName
        ) {
            this(ollamaUrl, model, minConfidence, dpi, dryRun, outputFileName, true);
        }
    }

    public record PageProtectionEvaluation(
            int pageNumber,
            boolean isCover,
            boolean protectedPage,
            String protectionReason,
            List<String> matchedProtectedTerms,
            int wordCount
    ) {
    }

    public MagazineAdRemovalService(
            LibraryProperties properties,
            DocumentRepository documentRepository,
            StoragePathService storagePathService,
            DirectoryScannerService scannerService,
            OllamaLlmClient ollamaLlmClient
    ) {
        this.properties = properties;
        this.documentRepository = documentRepository;
        this.storagePathService = storagePathService;
        this.scannerService = scannerService;
        this.ollamaLlmClient = ollamaLlmClient;
    }

    /**
     * Validates and resolves settings from the request and application defaults.
     * Never silently rewrites the model name.
     */
    public ResolvedAdRemovalSettings resolveAndValidateSettings(AdRemovalRequest request) {
        LibraryProperties.AdRemovalProperties defaults = properties.adRemoval();

        String defaultUrl = (defaults != null && defaults.ollamaUrl() != null && !defaults.ollamaUrl().isBlank())
                ? defaults.ollamaUrl()
                : OllamaLlmClient.DEFAULT_OLLAMA_URL;
        String ollamaUrl = (request != null && request.ollamaUrl() != null && !request.ollamaUrl().isBlank())
                ? request.ollamaUrl().strip().replaceAll("/+$", "")
                : defaultUrl.strip().replaceAll("/+$", "");

        String defaultModel = (defaults != null && defaults.model() != null && !defaults.model().isBlank())
                ? defaults.model()
                : OllamaLlmClient.DEFAULT_VLM_MODEL;
        String model;
        if (request != null && request.model() != null) {
            if (request.model().isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ollama-Modellname darf nicht leer sein.");
            }
            // Keep exact model name without rewriting
            model = request.model().strip();
        } else {
            model = defaultModel;
        }

        double minConfidence;
        if (request != null && request.minConfidence() != null) {
            minConfidence = request.minConfidence();
            if (!Double.isFinite(minConfidence) || minConfidence < 0.0 || minConfidence > 1.0) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Mindestkonfidenz muss ein endlicher Wert zwischen 0 und 1 sein."
                );
            }
        } else {
            minConfidence = (defaults != null && defaults.minConfidence() != null) ? defaults.minConfidence() : 0.75;
        }

        int dpi;
        if (request != null && request.dpi() != null) {
            dpi = request.dpi();
            if (dpi <= 0) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Rendering-Auflösung (DPI) muss eine positive Ganzzahl sein."
                );
            }
        } else {
            dpi = (defaults != null && defaults.dpi() != null && defaults.dpi() > 0) ? defaults.dpi() : 140;
        }

        boolean dryRun;
        if (request != null && request.dryRun() != null) {
            dryRun = request.dryRun();
        } else {
            dryRun = (defaults == null || defaults.dryRun() == null) || defaults.dryRun();
        }

        String outputFileName = (request != null && request.outputFileName() != null && !request.outputFileName().isBlank())
                ? request.outputFileName().strip()
                : null;

        boolean includeReason = (request == null || request.includeReason() == null) || request.includeReason();

        return new ResolvedAdRemovalSettings(ollamaUrl, model, minConfidence, dpi, dryRun, outputFileName, includeReason);
    }

    /**
     * Evaluates the protection rules for a given 1-based page number and its extracted Unicode text.
     * Rule 1: Page 1 is always protected as the Cover.
     * Rule 2: Pages with > 40 words containing standalone terms (inhaltsverzeichnis, inhalt, impressum, editorial)
     *         case-insensitively are protected.
     */
    public PageProtectionEvaluation evaluateProtection(int pageNumber, String pageText) {
        String safeText = pageText != null ? pageText : "";
        int wordCount = countWords(safeText);
        List<String> matchedTerms = findProtectedTerms(safeText);

        boolean isCover = (pageNumber == 1);
        boolean isKeywordProtected = (wordCount > 40 && !matchedTerms.isEmpty());
        boolean protectedPage = isCover || isKeywordProtected;

        String protectionReason = null;
        if (isCover && isKeywordProtected) {
            protectionReason = "Cover (Seite 1) & Geschützter Begriff (" + String.join(", ", matchedTerms) + ", " + wordCount + " Wörter)";
        } else if (isCover) {
            protectionReason = "Cover (Seite 1)";
        } else if (isKeywordProtected) {
            protectionReason = "Geschützter Begriff: " + String.join(", ", matchedTerms) + " (" + wordCount + " Wörter)";
        }

        return new PageProtectionEvaluation(
                pageNumber,
                isCover,
                protectedPage,
                protectionReason,
                matchedTerms,
                wordCount
        );
    }

    /**
     * Counts words in Unicode text using Unicode word boundaries.
     */
    public int countWords(String text) {
        if (text == null || text.isBlank()) {
            return 0;
        }
        Matcher matcher = UNICODE_WORD_PATTERN.matcher(text);
        int count = 0;
        while (matcher.find()) {
            count++;
        }
        return count;
    }

    /**
     * Finds distinct standalone protected terms (lowercase) in the given text using Unicode word boundaries.
     */
    public List<String> findProtectedTerms(String text) {
        if (text == null || text.isBlank()) {
            return Collections.emptyList();
        }
        Set<String> found = new LinkedHashSet<>();
        Matcher matcher = PROTECTED_TERMS_PATTERN.matcher(text);
        while (matcher.find()) {
            found.add(matcher.group(1).toLowerCase(Locale.ROOT));
        }
        return List.copyOf(found);
    }

    /**
     * Renders a single 0-based PDF page at the given DPI into a PNG byte array in memory (no temporary files).
     */
    public byte[] renderPageToPngBytesInMemory(PDFRenderer renderer, int pageIndex, int dpi) throws IOException {
        BufferedImage image = renderer.renderImageWithDPI(pageIndex, (float) dpi, ImageType.RGB);
        ByteArrayOutputStream baos = new ByteArrayOutputStream(64 * 1024);
        boolean written = ImageIO.write(image, "png", baos);
        if (!written) {
            throw new IOException("PNG-Encoder konnte das Seitenbild nicht im Arbeitsspeicher erzeugen.");
        }
        return baos.toByteArray();
    }

    /**
     * Synchronously analyzes all pages of a PDF document with the VLM and optionally creates a cleaned copy.
     */
    public AdRemovalReportDto analyzeAndCleanDocument(UUID documentId, AdRemovalRequest request) {
        return analyzeAndCleanDocument(documentId, request, null, () -> false);
    }

    /**
     * Analyzes all pages of a PDF document with the VLM (streaming progress per page if callback provided)
     * and creates a new cleaned PDF file if dryRun == false.
     */
    public AdRemovalReportDto analyzeAndCleanDocument(
            UUID documentId,
            AdRemovalRequest request,
            Consumer<PageAdAnalysisDto> onPageAnalyzed,
            BooleanSupplier isCancelled
    ) {
        ResolvedAdRemovalSettings settings = resolveAndValidateSettings(request);
        Document doc = findPdfDocumentOrThrow(documentId);
        Path sourcePdfPath = storagePathService.resolveDocumentPath(doc.getRelativePath());
        if (!Files.exists(sourcePdfPath)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PDF-Datei nicht auf der Festplatte gefunden: " + doc.getRelativePath());
        }

        Path logFilePath = resolveLogFilePath(sourcePdfPath);
        String logRelativePath = storagePathService.toRelativePath(logFilePath);
        long runStartMillis = System.currentTimeMillis();

        List<PageAdAnalysisDto> pageResults = new ArrayList<>();
        List<Integer> pagesMarkedForRemoval = new ArrayList<>();
        int totalPages;
        int protectedPagesCount = 0;
        int vlmAdCount = 0;
        int errorCount = 0;

        try (var randomAccessRead = new RandomAccessReadBufferedFile(sourcePdfPath);
             PDDocument pdDocument = Loader.loadPDF(randomAccessRead);
             BufferedWriter logWriter = openLogWriter(logFilePath)) {

            totalPages = pdDocument.getNumberOfPages();
            writeRunStartHeader(logWriter, doc.getRelativePath(), settings, totalPages);

            PDFRenderer renderer = new PDFRenderer(pdDocument);
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);

            for (int pageNum = 1; pageNum <= totalPages; pageNum++) {
                if (isCancelled != null && isCancelled.getAsBoolean()) {
                    writeLogLine(logWriter, "[" + nowTimestamp() + "] ABBRUCH: Analyse wurde auf Seite " + pageNum + "/" + totalPages + " abgebrochen.");
                    writeLogLine(logWriter, "================================================================================");
                    throw new ResponseStatusException(HttpStatus.ACCEPTED, "Analyse wurde abgebrochen.");
                }

                long pageStartMillis = System.currentTimeMillis();

                // 1. Extract text and evaluate protection rules
                String pageText = "";
                try {
                    stripper.setStartPage(pageNum);
                    stripper.setEndPage(pageNum);
                    String extracted = stripper.getText(pdDocument);
                    pageText = extracted != null ? extracted.strip() : "";
                } catch (Exception textEx) {
                    log.warn("Text extraction failed on page {} of {}: {}", pageNum, sourcePdfPath, textEx.getMessage());
                }

                PageProtectionEvaluation protection = evaluateProtection(pageNum, pageText);
                if (protection.protectedPage()) {
                    protectedPagesCount++;
                }

                // 2. Render and check EVERY page with the VLM (including Cover, protected pages, text-heavy pages, pages without images)
                Boolean vlmIsAd = null;
                Double vlmConfidence = null;
                String vlmReason = null;
                String vlmError = null;

                try {
                    byte[] pngBytes = renderPageToPngBytesInMemory(renderer, pageNum - 1, settings.dpi());
                    OllamaLlmClient.VlmCallResult vlmResult = ollamaLlmClient.classifyPageImageWithVlm(
                            settings.ollamaUrl(),
                            settings.model(),
                            pngBytes,
                            settings.includeReason()
                    );

                    if (vlmResult.isSuccess()) {
                        OllamaLlmClient.VlmAdDecision decision = vlmResult.decision();
                        vlmIsAd = decision.isAd();
                        vlmConfidence = decision.confidence();
                        vlmReason = decision.reason();
                        if (decision.isAd() && decision.confidence() >= settings.minConfidence()) {
                            vlmAdCount++;
                        }
                    } else {
                        vlmError = vlmResult.error();
                        errorCount++;
                    }
                } catch (Exception renderEx) {
                    log.warn("Failed rendering or analyzing page {} of {}: {}", pageNum, sourcePdfPath, renderEx.getMessage());
                    vlmError = "Fehler beim Rendern der Seite: " + renderEx.getMessage();
                    errorCount++;
                }

                // 3. Decision: Only mark non-protected pages as ads to remove when is_ad == true && confidence >= minConfidence
                boolean markedForRemoval = !protection.protectedPage()
                        && vlmError == null
                        && Boolean.TRUE.equals(vlmIsAd)
                        && vlmConfidence != null
                        && vlmConfidence >= settings.minConfidence();

                if (markedForRemoval) {
                    pagesMarkedForRemoval.add(pageNum);
                }

                PageAdAnalysisDto pageDto = new PageAdAnalysisDto(
                        pageNum,
                        protection.isCover(),
                        protection.protectedPage(),
                        protection.protectionReason(),
                        protection.matchedProtectedTerms(),
                        protection.wordCount(),
                        vlmIsAd,
                        vlmConfidence,
                        vlmReason,
                        vlmError,
                        markedForRemoval
                );
                pageResults.add(pageDto);

                long pageDurationMillis = Math.max(0L, System.currentTimeMillis() - pageStartMillis);
                writePageLogEntry(logWriter, pageDto, totalPages, settings.minConfidence(), pageDurationMillis);

                if (onPageAnalyzed != null) {
                    onPageAnalyzed.accept(pageDto);
                }
            }

            UUID cleanedDocId = null;
            String cleanedFileName = null;
            String cleanedRelPath = null;

            if (!settings.dryRun()) {
                CreatedCleanedPdf created = createCleanedPdfFile(sourcePdfPath, pagesMarkedForRemoval, settings.outputFileName());
                cleanedDocId = created.documentId();
                cleanedFileName = created.fileName();
                cleanedRelPath = created.relativePath();
            }

            int removedCount = pagesMarkedForRemoval.size();
            int keptCount = Math.max(0, totalPages - removedCount);
            long totalDurationMillis = Math.max(0L, System.currentTimeMillis() - runStartMillis);

            writeRunSummaryFooter(
                    logWriter,
                    totalPages,
                    protectedPagesCount,
                    vlmAdCount,
                    removedCount,
                    keptCount,
                    errorCount,
                    settings.dryRun(),
                    settings.minConfidence(),
                    pagesMarkedForRemoval,
                    cleanedRelPath,
                    totalDurationMillis
            );

            return new AdRemovalReportDto(
                    doc.getId(),
                    doc.getFileName(),
                    doc.getRelativePath(),
                    totalPages,
                    protectedPagesCount,
                    vlmAdCount,
                    removedCount,
                    keptCount,
                    errorCount,
                    settings.dryRun(),
                    settings.ollamaUrl(),
                    settings.model(),
                    settings.minConfidence(),
                    settings.dpi(),
                    List.copyOf(pagesMarkedForRemoval),
                    List.copyOf(pageResults),
                    cleanedDocId,
                    cleanedFileName,
                    cleanedRelPath,
                    logRelativePath
            );
        } catch (ResponseStatusException rse) {
            throw rse;
        } catch (IOException e) {
            log.error("Failed reading PDF {} for ad analysis: {}", sourcePdfPath, e.getMessage(), e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "PDF konnte nicht gelesen werden: " + e.getMessage());
        }
    }

    /**
     * Applies ad removal to create a new PDF file from a list of 1-based page numbers,
     * strictly re-verifying protection rules (Cover & protected keywords with > 40 words) so protected pages
     * can never be removed.
     */
    public AdRemovalReportDto applyCleanedPdf(UUID documentId, ApplyAdRemovalRequest applyRequest) {
        Document doc = findPdfDocumentOrThrow(documentId);
        Path sourcePdfPath = storagePathService.resolveDocumentPath(doc.getRelativePath());
        if (!Files.exists(sourcePdfPath)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PDF-Datei nicht auf der Festplatte gefunden: " + doc.getRelativePath());
        }

        Path logFilePath = resolveLogFilePath(sourcePdfPath);
        String logRelativePath = storagePathService.toRelativePath(logFilePath);
        long runStartMillis = System.currentTimeMillis();

        Set<Integer> requestedRemovals = (applyRequest != null && applyRequest.pagesToRemove() != null)
                ? new HashSet<>(applyRequest.pagesToRemove())
                : Collections.emptySet();
        String outputFileName = (applyRequest != null && applyRequest.outputFileName() != null && !applyRequest.outputFileName().isBlank())
                ? applyRequest.outputFileName().strip()
                : null;

        List<Integer> allowedRemovals = new ArrayList<>();
        int totalPages;
        int protectedPagesCount = 0;

        try (var randomAccessRead = new RandomAccessReadBufferedFile(sourcePdfPath);
             PDDocument pdDocument = Loader.loadPDF(randomAccessRead)) {

            totalPages = pdDocument.getNumberOfPages();
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);

            for (int pageNum = 1; pageNum <= totalPages; pageNum++) {
                stripper.setStartPage(pageNum);
                stripper.setEndPage(pageNum);
                String pageText = "";
                try {
                    String extracted = stripper.getText(pdDocument);
                    pageText = extracted != null ? extracted.strip() : "";
                } catch (Exception ignored) {
                }

                PageProtectionEvaluation protection = evaluateProtection(pageNum, pageText);
                if (protection.protectedPage()) {
                    protectedPagesCount++;
                } else if (requestedRemovals.contains(pageNum)) {
                    allowedRemovals.add(pageNum);
                }
            }
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "PDF konnte nicht verarbeitet werden: " + e.getMessage());
        }

        CreatedCleanedPdf created = createCleanedPdfFile(sourcePdfPath, allowedRemovals, outputFileName);
        int removedCount = allowedRemovals.size();
        int keptCount = Math.max(0, totalPages - removedCount);
        long totalDurationMillis = Math.max(0L, System.currentTimeMillis() - runStartMillis);

        try (BufferedWriter logWriter = openLogWriter(logFilePath)) {
            writeApplyCleanupLog(
                    logWriter,
                    doc.getRelativePath(),
                    totalPages,
                    protectedPagesCount,
                    allowedRemovals,
                    keptCount,
                    created.relativePath(),
                    totalDurationMillis
            );
        } catch (IOException logEx) {
            log.warn("Could not write apply-cleanup log to {}: {}", logFilePath, logEx.getMessage());
        }

        ResolvedAdRemovalSettings defaults = resolveAndValidateSettings(null);
        return new AdRemovalReportDto(
                doc.getId(),
                doc.getFileName(),
                doc.getRelativePath(),
                totalPages,
                protectedPagesCount,
                removedCount,
                removedCount,
                keptCount,
                0,
                false,
                defaults.ollamaUrl(),
                defaults.model(),
                defaults.minConfidence(),
                defaults.dpi(),
                List.copyOf(allowedRemovals),
                Collections.emptyList(),
                created.documentId(),
                created.fileName(),
                created.relativePath(),
                logRelativePath
        );
    }

    private record CreatedCleanedPdf(UUID documentId, String fileName, String relativePath, Path fullPath) {
    }

    /**
     * Creates a new PDF file with the specified 1-based pages removed, preserving the original PDF untouched,
     * and indexes the new PDF in SQLite and Lucene.
     */
    private CreatedCleanedPdf createCleanedPdfFile(
            Path sourcePdfPath,
            List<Integer> pagesToRemoveOneBased,
            String customOutputFileName
    ) {
        Path targetPath = resolveUniqueOutputPdfPath(sourcePdfPath, customOutputFileName);

        try (var randomAccessRead = new RandomAccessReadBufferedFile(sourcePdfPath);
             PDDocument pdDocument = Loader.loadPDF(randomAccessRead)) {

            int totalPages = pdDocument.getNumberOfPages();
            List<Integer> validPagesDesc = pagesToRemoveOneBased.stream()
                    .filter(Objects::nonNull)
                    .distinct()
                    // Never remove page 1 (Cover)
                    .filter(p -> p > 1 && p <= totalPages)
                    .sorted(Comparator.reverseOrder())
                    .toList();

            for (int pageNumOneBased : validPagesDesc) {
                pdDocument.removePage(pageNumOneBased - 1);
            }

            if (targetPath.getParent() != null) {
                Files.createDirectories(targetPath.getParent());
            }
            pdDocument.save(targetPath.toFile());
        } catch (IOException e) {
            log.error("Failed to create cleaned PDF at {}: {}", targetPath, e.getMessage(), e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Bereinigte PDF-Datei konnte nicht gespeichert werden: " + e.getMessage());
        }

        // Ingest the newly created PDF into SQLite & Lucene
        scannerService.ingestOrUpdateFile(targetPath, true, true);
        String newRelPath = storagePathService.toRelativePath(targetPath);
        Optional<Document> savedDoc = documentRepository.findByRelativePath(newRelPath);

        UUID newDocId = savedDoc.map(Document::getId).orElse(null);
        String newFileName = savedDoc.map(Document::getFileName).orElseGet(() -> targetPath.getFileName().toString());

        log.info("Created cleaned magazine PDF {} (removed {} pages from {})", newRelPath, pagesToRemoveOneBased.size(), sourcePdfPath);
        return new CreatedCleanedPdf(newDocId, newFileName, newRelPath, targetPath);
    }

    private Path resolveUniqueOutputPdfPath(Path sourcePdfPath, String customOutputFileName) {
        Path parentDir = sourcePdfPath.getParent() != null ? sourcePdfPath.getParent() : storagePathService.getRootPath();
        String sourceFileName = sourcePdfPath.getFileName().toString();
        String baseName = sourceFileName.toLowerCase(Locale.ROOT).endsWith(".pdf")
                ? sourceFileName.substring(0, sourceFileName.length() - 4)
                : sourceFileName;

        String desiredBase;
        if (customOutputFileName != null && !customOutputFileName.isBlank()) {
            String sanitized = customOutputFileName.replaceAll("[\\\\/:*?\"<>|]", "_").strip();
            if (sanitized.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
                sanitized = sanitized.substring(0, sanitized.length() - 4).strip();
            }
            desiredBase = sanitized.isEmpty() ? baseName + "_bereinigt" : sanitized;
        } else {
            desiredBase = baseName + "_bereinigt";
        }

        Path candidate = parentDir.resolve(desiredBase + ".pdf").normalize();
        if (!candidate.startsWith(storagePathService.getRootPath())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ungültiger Ausgabedateiname.");
        }

        int suffix = 2;
        while (Files.exists(candidate) || candidate.equals(sourcePdfPath.toAbsolutePath().normalize())) {
            candidate = parentDir.resolve(desiredBase + "_" + suffix + ".pdf").normalize();
            suffix++;
        }

        return candidate;
    }

    /**
     * Resolves the .log file path in the same directory and with the same base name as the source PDF file.
     * Example: Magazines/Ausgabe_01_2025.pdf -> Magazines/Ausgabe_01_2025.log
     */
    public Path resolveLogFilePath(Path sourcePdfPath) {
        Path parentDir = sourcePdfPath.getParent() != null ? sourcePdfPath.getParent() : storagePathService.getRootPath();
        String sourceFileName = sourcePdfPath.getFileName().toString();
        String baseName = sourceFileName.toLowerCase(Locale.ROOT).endsWith(".pdf")
                ? sourceFileName.substring(0, sourceFileName.length() - 4)
                : sourceFileName;

        Path logPath = parentDir.resolve(baseName + ".log").normalize();
        if (!logPath.startsWith(storagePathService.getRootPath())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ungültiger Log-Dateipfad.");
        }
        return logPath;
    }

    private BufferedWriter openLogWriter(Path logFilePath) throws IOException {
        if (logFilePath.getParent() != null) {
            Files.createDirectories(logFilePath.getParent());
        }
        return Files.newBufferedWriter(
                logFilePath,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND
        );
    }

    private String nowTimestamp() {
        return LocalDateTime.now().format(LOG_TS_FORMAT);
    }

    private void writeLogLine(BufferedWriter writer, String line) {
        if (writer == null) {
            return;
        }
        try {
            writer.write(line);
            writer.newLine();
            writer.flush();
        } catch (IOException e) {
            log.warn("Failed writing to ad-removal log file: {}", e.getMessage());
        }
    }

    private void writeRunStartHeader(
            BufferedWriter writer,
            String sourceRelPath,
            ResolvedAdRemovalSettings settings,
            int totalPages
    ) {
        writeLogLine(writer, "================================================================================");
        writeLogLine(writer, "PDForever — Werbeanzeigen-Erkennung & Bereinigung (VLM-Lauf)");
        writeLogLine(writer, "================================================================================");
        writeLogLine(writer, "Startzeitpunkt    : " + nowTimestamp());
        writeLogLine(writer, "Quelldatei        : " + sourceRelPath);
        writeLogLine(writer, "Modus             : " + (settings.dryRun() ? "Dry-Run (Nur Analyse)" : "Bereinigung (Neue PDF erstellen)"));
        writeLogLine(writer, "Ollama-Adresse    : " + settings.ollamaUrl());
        writeLogLine(writer, "VLM-Modell        : " + settings.model());
        writeLogLine(writer, String.format(Locale.ROOT, "Mindestkonfidenz  : %.2f", settings.minConfidence()));
        writeLogLine(writer, "Auflösung         : " + settings.dpi() + " DPI");
        writeLogLine(writer, "Gesamtseiten      : " + totalPages);
        writeLogLine(writer, "--------------------------------------------------------------------------------");
    }

    private void writePageLogEntry(
            BufferedWriter writer,
            PageAdAnalysisDto page,
            int totalPages,
            double minConfidence,
            long durationMillis
    ) {
        String actionText;
        if (page.markedForRemoval()) {
            actionText = "ENTFERNEN (Werbung erkannt)";
        } else if (page.protectedPage()) {
            actionText = "BEHALTEN (Geschützt: " + (page.protectionReason() != null ? page.protectionReason() : "Schutzregel") + ")";
        } else if (page.vlmError() != null) {
            actionText = "BEHALTEN (VLM-Fehler)";
        } else if (Boolean.TRUE.equals(page.vlmIsAd())) {
            actionText = String.format(Locale.ROOT, "BEHALTEN (Konfidenz %.2f < %.2f)",
                    page.vlmConfidence() != null ? page.vlmConfidence() : 0.0, minConfidence);
        } else {
            actionText = "BEHALTEN (Keine Werbung)";
        }

        writeLogLine(writer, String.format(
                Locale.ROOT,
                "[%s] Seite %d/%d (%d ms) -> %s",
                nowTimestamp(),
                page.pageNumber(),
                totalPages,
                durationMillis,
                actionText
        ));

        writeLogLine(writer, String.format(
                Locale.ROOT,
                "  Schutzprüfung : geschützt=%s | Cover=%s | Wörter=%d | Schutzbegriffe=%s%s",
                page.protectedPage(),
                page.isCover(),
                page.wordCount(),
                page.matchedProtectedTerms() != null ? page.matchedProtectedTerms() : List.of(),
                page.protectionReason() != null ? " | Grund=\"" + page.protectionReason() + "\"" : ""
        ));

        if (page.vlmError() != null) {
            writeLogLine(writer, "  VLM-Fehler    : " + page.vlmError());
        } else {
            writeLogLine(writer, String.format(
                    Locale.ROOT,
                    "  VLM-Urteil    : is_ad=%s | confidence=%.4f | reason=\"%s\"",
                    page.vlmIsAd(),
                    page.vlmConfidence() != null ? page.vlmConfidence() : 0.0,
                    page.vlmReason() != null ? page.vlmReason() : ""
            ));
        }
    }

    private void writeRunSummaryFooter(
            BufferedWriter writer,
            int totalPages,
            int protectedPagesCount,
            int vlmAdCount,
            int removedCount,
            int keptCount,
            int errorCount,
            boolean dryRun,
            double minConfidence,
            List<Integer> pagesMarkedForRemoval,
            String cleanedRelPath,
            long totalDurationMillis
    ) {
        writeLogLine(writer, "--------------------------------------------------------------------------------");
        writeLogLine(writer, "ERGEBNIS DES LAUFS");
        writeLogLine(writer, "--------------------------------------------------------------------------------");
        writeLogLine(writer, String.format(
                Locale.ROOT,
                "Endzeitpunkt             : %s (Gesamtdauer: %.2f s)",
                nowTimestamp(),
                totalDurationMillis / 1000.0
        ));
        writeLogLine(writer, "Geprüfte Seiten gesamt   : " + totalPages);
        writeLogLine(writer, "Geschützte Seiten        : " + protectedPagesCount);
        writeLogLine(writer, String.format(Locale.ROOT, "VLM als Werbung erkannt  : %d (ab Mindestkonfidenz %.2f)", vlmAdCount, minConfidence));
        writeLogLine(writer, "Zum Entfernen markiert   : " + removedCount + " -> Seiten: " + pagesMarkedForRemoval);
        writeLogLine(writer, "Behaltene Seiten         : " + keptCount);
        writeLogLine(writer, "VLM-/Render-Fehler       : " + errorCount);
        if (dryRun) {
            writeLogLine(writer, "Erstellte bereinigte PDF : - (Dry-Run, keine Datei geschrieben)");
        } else {
            writeLogLine(writer, "Erstellte bereinigte PDF : " + (cleanedRelPath != null ? cleanedRelPath : "-") + " (" + keptCount + " Seiten)");
        }
        writeLogLine(writer, "================================================================================");
        writeLogLine(writer, "");
    }

    private void writeApplyCleanupLog(
            BufferedWriter writer,
            String sourceRelPath,
            int totalPages,
            int protectedPagesCount,
            List<Integer> removedPages,
            int keptCount,
            String cleanedRelPath,
            long totalDurationMillis
    ) {
        writeLogLine(writer, "================================================================================");
        writeLogLine(writer, "PDForever — Bereinigte PDF aus Analyse-Ergebnis erstellt");
        writeLogLine(writer, "================================================================================");
        writeLogLine(writer, String.format(
                Locale.ROOT,
                "Zeitpunkt                : %s (Dauer: %.2f s)",
                nowTimestamp(),
                totalDurationMillis / 1000.0
        ));
        writeLogLine(writer, "Quelldatei               : " + sourceRelPath);
        writeLogLine(writer, "Gesamtseiten             : " + totalPages);
        writeLogLine(writer, "Geschützte Seiten        : " + protectedPagesCount);
        writeLogLine(writer, "Entfernte Seiten         : " + removedPages.size() + " -> Seiten: " + removedPages);
        writeLogLine(writer, "Verbleibende Seiten      : " + keptCount);
        writeLogLine(writer, "Erstellte bereinigte PDF : " + (cleanedRelPath != null ? cleanedRelPath : "-"));
        writeLogLine(writer, "================================================================================");
        writeLogLine(writer, "");
    }

    private Document findPdfDocumentOrThrow(UUID documentId) {
        Document doc = documentRepository.findById(documentId)
                .filter(d -> !d.isDeleted())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Dokument nicht gefunden: " + documentId));

        String format = doc.getFormat();
        String relPath = doc.getRelativePath() != null ? doc.getRelativePath().toLowerCase(Locale.ROOT) : "";
        if ((format != null && !"PDF".equalsIgnoreCase(format)) || !relPath.endsWith(".pdf")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Werbeanzeigen-Entfernung wird nur für PDF-Dokumente unterstützt.");
        }
        return doc;
    }
}
