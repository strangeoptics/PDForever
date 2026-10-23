package com.pdforever.service;

import com.pdforever.dto.TocItemDto;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSBase;
import org.apache.pdfbox.io.RandomAccessReadBufferedFile;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentCatalog;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.interactive.action.PDActionGoTo;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.destination.PDPageDestination;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDDocumentOutline;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineNode;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class PdfExtractionService {

    private static final Logger log = LoggerFactory.getLogger(PdfExtractionService.class);
    private static final int MAX_COVER_WIDTH = 420;
    private static final float COVER_RENDER_DPI = 120f;

    public record ExtractedPdfData(int pageCount, List<String> pageTexts, boolean valid) {
    }

    /**
     * Renders the first page (cover) of a PDF file to a JPEG thumbnail image at targetImagePath.
     */
    public boolean renderCoverImage(Path pdfPath, Path targetImagePath) {
        try (var randomAccessRead = new RandomAccessReadBufferedFile(pdfPath);
             PDDocument pdDocument = Loader.loadPDF(randomAccessRead)) {

            if (pdDocument.getNumberOfPages() <= 0) {
                return false;
            }

            PDFRenderer renderer = new PDFRenderer(pdDocument);
            BufferedImage rendered = renderer.renderImageWithDPI(0, COVER_RENDER_DPI, ImageType.RGB);

            BufferedImage outputImage = rendered;
            if (rendered.getWidth() > MAX_COVER_WIDTH && rendered.getHeight() > 0) {
                int targetWidth = MAX_COVER_WIDTH;
                int targetHeight = Math.max(1, Math.round((float) rendered.getHeight() * targetWidth / rendered.getWidth()));
                BufferedImage scaled = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB);
                Graphics2D g2d = scaled.createGraphics();
                try {
                    g2d.setColor(Color.WHITE);
                    g2d.fillRect(0, 0, targetWidth, targetHeight);
                    g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                    g2d.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
                    g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                    g2d.drawImage(rendered, 0, 0, targetWidth, targetHeight, null);
                } finally {
                    g2d.dispose();
                }
                outputImage = scaled;
            }

            if (targetImagePath.getParent() != null) {
                Files.createDirectories(targetImagePath.getParent());
            }
            return ImageIO.write(outputImage, "jpg", targetImagePath.toFile());
        } catch (IOException | RuntimeException ex) {
            log.warn("Failed to render cover image for {}: {}", pdfPath, ex.getMessage());
            return false;
        }
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

    /**
     * Extracts the hierarchical Table of Contents (PDF bookmarks / outline) using Apache PDFBox 3.x.
     */
    public List<TocItemDto> extractOutline(Path pdfPath) {
        try (var randomAccessRead = new RandomAccessReadBufferedFile(pdfPath);
             PDDocument pdDocument = Loader.loadPDF(randomAccessRead)) {

            PDDocumentCatalog catalog = pdDocument.getDocumentCatalog();
            if (catalog == null) {
                return Collections.emptyList();
            }
            PDDocumentOutline outline = catalog.getDocumentOutline();
            if (outline == null) {
                return Collections.emptyList();
            }

            Set<COSBase> visited = new HashSet<>();
            return extractOutlineNodes(pdDocument, outline, visited, 0);
        } catch (IOException | RuntimeException ex) {
            log.warn("Failed to extract outline from {}: {}", pdfPath, ex.getMessage());
            return Collections.emptyList();
        }
    }

    private List<TocItemDto> extractOutlineNodes(
            PDDocument pdDocument,
            PDOutlineNode parentNode,
            Set<COSBase> visited,
            int depth
    ) {
        if (depth > 8 || parentNode == null) {
            return Collections.emptyList();
        }

        List<TocItemDto> result = new ArrayList<>();
        PDOutlineItem current = parentNode.getFirstChild();
        int count = 0;

        while (current != null && count < 400) {
            count++;
            COSBase cosObj = current.getCOSObject();
            if (cosObj != null && !visited.add(cosObj)) {
                break;
            }

            String rawTitle = current.getTitle();
            String title = (rawTitle != null && !rawTitle.isBlank()) ? rawTitle.strip() : "Kapitel";
            Integer pageNumber = resolveOutlinePageNumber(pdDocument, current);
            List<TocItemDto> children = extractOutlineNodes(pdDocument, current, visited, depth + 1);

            result.add(new TocItemDto(title, pageNumber, children));
            current = current.getNextSibling();
        }

        return result;
    }

    private Integer resolveOutlinePageNumber(PDDocument pdDocument, PDOutlineItem item) {
        try {
            PDPage page = item.findDestinationPage(pdDocument);
            if (page != null) {
                int idx = pdDocument.getPages().indexOf(page);
                if (idx >= 0) {
                    return idx + 1;
                }
            }
        } catch (Exception ignored) {
        }

        try {
            if (item.getDestination() instanceof PDPageDestination pageDest) {
                int pageNum = pageDest.retrievePageNumber();
                if (pageNum >= 0) {
                    return pageNum + 1;
                }
            } else if (item.getAction() instanceof PDActionGoTo goTo && goTo.getDestination() instanceof PDPageDestination pageDest) {
                int pageNum = pageDest.retrievePageNumber();
                if (pageNum >= 0) {
                    return pageNum + 1;
                }
            }
        } catch (Exception ignored) {
        }

        return null;
    }
}

