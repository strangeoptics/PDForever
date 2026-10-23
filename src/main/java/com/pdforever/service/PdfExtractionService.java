package com.pdforever.service;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.io.RandomAccessReadBufferedFile;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Service
public class PdfExtractionService {

    private static final Logger log = LoggerFactory.getLogger(PdfExtractionService.class);

    public record ExtractedPdfData(int pageCount, List<String> pageTexts, boolean valid) {
    }

    /**
     * Extracts page count and page-by-page text from a PDF file using Apache PDFBox 3.x.
     * Gracefully handles corrupt or unreadable PDFs without crashing the ingestion pipeline.
     */
    public ExtractedPdfData extractPdfPages(Path pdfPath) {
        try (var randomAccessRead = new RandomAccessReadBufferedFile(pdfPath);
             PDDocument pdDocument = Loader.loadPDF(randomAccessRead)) {

            int totalPages = pdDocument.getNumberOfPages();
            if (totalPages <= 0) {
                return new ExtractedPdfData(0, Collections.emptyList(), true);
            }

            List<String> pages = new ArrayList<>(totalPages);
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);

            for (int page = 1; page <= totalPages; page++) {
                try {
                    stripper.setStartPage(page);
                    stripper.setEndPage(page);
                    String text = stripper.getText(pdDocument);
                    pages.add(text != null ? text.strip() : "");
                } catch (Exception pageEx) {
                    log.warn("Failed to extract text from page {} of {}: {}", page, pdfPath, pageEx.getMessage());
                    pages.add("");
                }
            }

            return new ExtractedPdfData(totalPages, pages, true);
        } catch (IOException | RuntimeException ex) {
            log.error("Corrupt or unreadable PDF file at {}: {}", pdfPath, ex.getMessage());
            return new ExtractedPdfData(0, Collections.emptyList(), false);
        }
    }
}

