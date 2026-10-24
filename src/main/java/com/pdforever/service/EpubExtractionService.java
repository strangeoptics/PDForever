package com.pdforever.service;

import com.pdforever.dto.TocItemDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.imageio.ImageIO;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

@Service
public class EpubExtractionService {

    private static final Logger log = LoggerFactory.getLogger(EpubExtractionService.class);
    private static final int MAX_COVER_WIDTH = 420;

    private static final Pattern HTML_TAG_PATTERN = Pattern.compile("<[^>]*>", Pattern.DOTALL);
    private static final Pattern BODY_PATTERN = Pattern.compile("<body[^>]*>(.*?)</body>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern IMG_SRC_PATTERN = Pattern.compile("(<(?:img|image)[^>]+(?:src|href|xlink:href)=[\"'])([^\"']+)([\"'])", Pattern.CASE_INSENSITIVE);
    private static final Pattern YEAR_PATTERN = Pattern.compile("\\b(18\\d{2}|19\\d{2}|20\\d{2})\\b");

    public record ExtractedEpubData(
            int chapterCount,
            List<String> chapterTexts,
            String title,
            String authors,
            String identifier,
            Integer publicationYear,
            String description,
            boolean valid
    ) {
    }

    public record ChapterInfo(
            int index,
            String id,
            String href,
            String title
    ) {
    }

    /**
     * Extracts metadata and chapter texts from an EPUB file for Lucene indexing and cataloging.
     */
    public ExtractedEpubData extractEpubData(Path epubPath) {
        if (!Files.isRegularFile(epubPath)) {
            return new ExtractedEpubData(0, Collections.emptyList(), null, null, null, null, null, false);
        }

        try (ZipFile zipFile = new ZipFile(epubPath.toFile(), StandardCharsets.UTF_8)) {
            String opfPath = findOpfPath(zipFile);
            if (opfPath == null) {
                log.warn("Could not find OPF package document in EPUB: {}", epubPath);
                return new ExtractedEpubData(0, Collections.emptyList(), null, null, null, null, null, false);
            }

            ZipEntry opfEntry = zipFile.getEntry(opfPath);
            if (opfEntry == null) {
                log.warn("OPF entry {} not found in EPUB: {}", opfPath, epubPath);
                return new ExtractedEpubData(0, Collections.emptyList(), null, null, null, null, null, false);
            }

            Document opfDoc;
            try (InputStream is = zipFile.getInputStream(opfEntry)) {
                opfDoc = parseXml(is);
            }

            String opfDir = getParentPath(opfPath);

            // 1. Metadata
            String title = getTagText(opfDoc, "dc:title");
            String authors = getTagText(opfDoc, "dc:creator");
            String identifier = getTagText(opfDoc, "dc:identifier");
            String dateStr = getTagText(opfDoc, "dc:date");
            Integer pubYear = parseYear(dateStr);
            String description = getTagText(opfDoc, "dc:description");

            // 2. Manifest & Spine
            Map<String, String> manifestIdToHref = new LinkedHashMap<>();
            NodeList itemNodes = opfDoc.getElementsByTagName("item");
            for (int i = 0; i < itemNodes.getLength(); i++) {
                Element item = (Element) itemNodes.item(i);
                manifestIdToHref.put(item.getAttribute("id"), item.getAttribute("href"));
            }

            List<String> spineHrefs = new ArrayList<>();
            NodeList itemrefNodes = opfDoc.getElementsByTagName("itemref");
            for (int i = 0; i < itemrefNodes.getLength(); i++) {
                Element itemref = (Element) itemrefNodes.item(i);
                String idref = itemref.getAttribute("idref");
                String href = manifestIdToHref.get(idref);
                if (href != null && !href.isBlank()) {
                    spineHrefs.add(href);
                }
            }

            // 3. Extract plain text from each spine chapter
            List<String> chapterTexts = new ArrayList<>(spineHrefs.size());
            for (String href : spineHrefs) {
                String fullChapterPath = resolveRelativePath(opfDir, href);
                ZipEntry chapterEntry = findZipEntryIgnoreCase(zipFile, fullChapterPath);
                if (chapterEntry != null) {
                    try (InputStream cis = zipFile.getInputStream(chapterEntry)) {
                        String rawHtml = new String(cis.readAllBytes(), StandardCharsets.UTF_8);
                        String cleanText = stripHtml(rawHtml);
                        chapterTexts.add(cleanText);
                    } catch (Exception ex) {
                        log.debug("Failed reading spine chapter {}: {}", fullChapterPath, ex.getMessage());
                        chapterTexts.add("");
                    }
                } else {
                    chapterTexts.add("");
                }
            }

            int count = Math.max(1, chapterTexts.size());
            return new ExtractedEpubData(count, chapterTexts, title, authors, identifier, pubYear, description, true);
        } catch (Exception e) {
            log.error("Failed extracting EPUB data from {}: {}", epubPath, e.getMessage(), e);
            return new ExtractedEpubData(0, Collections.emptyList(), null, null, null, null, null, false);
        }
    }

    /**
     * Renders or extracts the cover image from an EPUB and saves it as a scaled JPEG thumbnail.
     * Generates an elegant fallback cover if the EPUB lacks a cover image.
     */
    public boolean renderCoverImage(Path epubPath, Path targetImagePath) {
        if (!Files.isRegularFile(epubPath)) {
            return false;
        }

        try (ZipFile zipFile = new ZipFile(epubPath.toFile(), StandardCharsets.UTF_8)) {
            String opfPath = findOpfPath(zipFile);
            String coverHref = null;
            String opfDir = "";

            if (opfPath != null) {
                opfDir = getParentPath(opfPath);
                ZipEntry opfEntry = zipFile.getEntry(opfPath);
                if (opfEntry != null) {
                    try (InputStream is = zipFile.getInputStream(opfEntry)) {
                        Document opfDoc = parseXml(is);
                        coverHref = findCoverHref(opfDoc, zipFile, opfDir);
                    } catch (Exception e) {
                        log.debug("Could not parse OPF for cover href: {}", e.getMessage());
                    }
                }
            }

            // Fallback: search zip entries for any image named cover
            if (coverHref == null) {
                coverHref = findCoverEntryInZip(zipFile);
            }

            BufferedImage image = null;
            if (coverHref != null) {
                String fullPath = resolveRelativePath(opfDir, coverHref);
                ZipEntry coverEntry = findZipEntryIgnoreCase(zipFile, fullPath);
                if (coverEntry == null) {
                    coverEntry = findZipEntryIgnoreCase(zipFile, coverHref);
                }
                if (coverEntry != null) {
                    try (InputStream imgIs = zipFile.getInputStream(coverEntry)) {
                        image = ImageIO.read(imgIs);
                    } catch (Exception e) {
                        log.debug("ImageIO failed to read cover image {}: {}", coverEntry.getName(), e.getMessage());
                    }
                }
            }

            // If no embedded cover found or readable, generate an elegant synthetic book cover
            if (image == null) {
                ExtractedEpubData meta = extractEpubData(epubPath);
                image = generateSyntheticCover(
                        meta.title() != null ? meta.title() : epubPath.getFileName().toString().replaceFirst("\\.[^.]+$", ""),
                        meta.authors() != null ? meta.authors() : "EPUB Document"
                );
            }

            BufferedImage outputImage = image;
            if (image.getWidth() > MAX_COVER_WIDTH && image.getHeight() > 0) {
                int targetWidth = MAX_COVER_WIDTH;
                int targetHeight = Math.max(1, Math.round((float) image.getHeight() * targetWidth / image.getWidth()));
                BufferedImage scaled = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB);
                Graphics2D g2d = scaled.createGraphics();
                try {
                    g2d.setColor(Color.WHITE);
                    g2d.fillRect(0, 0, targetWidth, targetHeight);
                    g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                    g2d.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
                    g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                    g2d.drawImage(image, 0, 0, targetWidth, targetHeight, null);
                } finally {
                    g2d.dispose();
                }
                outputImage = scaled;
            }

            if (targetImagePath.getParent() != null) {
                Files.createDirectories(targetImagePath.getParent());
            }
            return ImageIO.write(outputImage, "jpg", targetImagePath.toFile());
        } catch (Exception e) {
            log.warn("Failed rendering EPUB cover for {}: {}", epubPath, e.getMessage());
            return false;
        }
    }

    /**
     * Extracts outline (Table of Contents) from EPUB 2 NCX or EPUB 3 nav document.
     * Maps each chapter to its 1-based spine index as the pageNumber.
     */
    public List<TocItemDto> extractOutline(Path epubPath) {
        if (!Files.isRegularFile(epubPath)) {
            return Collections.emptyList();
        }

        try (ZipFile zipFile = new ZipFile(epubPath.toFile(), StandardCharsets.UTF_8)) {
            String opfPath = findOpfPath(zipFile);
            if (opfPath == null) {
                return Collections.emptyList();
            }

            ZipEntry opfEntry = zipFile.getEntry(opfPath);
            if (opfEntry == null) {
                return Collections.emptyList();
            }

            Document opfDoc;
            try (InputStream is = zipFile.getInputStream(opfEntry)) {
                opfDoc = parseXml(is);
            }

            String opfDir = getParentPath(opfPath);

            // Build map of href -> spine index (1-based)
            Map<String, String> manifestIdToHref = new HashMap<>();
            NodeList items = opfDoc.getElementsByTagName("item");
            for (int i = 0; i < items.getLength(); i++) {
                Element item = (Element) items.item(i);
                manifestIdToHref.put(item.getAttribute("id"), item.getAttribute("href"));
            }

            Map<String, Integer> hrefToSpineIndex = new HashMap<>();
            List<String> spineOrderHrefs = new ArrayList<>();
            NodeList itemrefs = opfDoc.getElementsByTagName("itemref");
            for (int i = 0; i < itemrefs.getLength(); i++) {
                Element ir = (Element) itemrefs.item(i);
                String href = manifestIdToHref.get(ir.getAttribute("idref"));
                if (href != null) {
                    int index = i + 1;
                    spineOrderHrefs.add(href);
                    hrefToSpineIndex.put(normalizeHref(href), index);
                }
            }

            // Look for NCX or Nav document
            String ncxHref = null;
            String navHref = null;
            for (int i = 0; i < items.getLength(); i++) {
                Element item = (Element) items.item(i);
                String mediaType = item.getAttribute("media-type");
                String properties = item.getAttribute("properties");
                if ("application/x-dtbncx+xml".equals(mediaType)) {
                    ncxHref = item.getAttribute("href");
                }
                if (properties != null && properties.contains("nav")) {
                    navHref = item.getAttribute("href");
                }
            }

            // 1. Try EPUB 3 Nav
            if (navHref != null) {
                String fullNavPath = resolveRelativePath(opfDir, navHref);
                ZipEntry navEntry = findZipEntryIgnoreCase(zipFile, fullNavPath);
                if (navEntry != null) {
                    try (InputStream is = zipFile.getInputStream(navEntry)) {
                        Document navDoc = parseXml(is);
                        List<TocItemDto> toc = parseNavDoc(navDoc, hrefToSpineIndex);
                        if (!toc.isEmpty()) {
                            return toc;
                        }
                    } catch (Exception e) {
                        log.debug("Nav parse failed, falling back: {}", e.getMessage());
                    }
                }
            }

            // 2. Try EPUB 2 NCX
            if (ncxHref != null) {
                String fullNcxPath = resolveRelativePath(opfDir, ncxHref);
                ZipEntry ncxEntry = findZipEntryIgnoreCase(zipFile, fullNcxPath);
                if (ncxEntry != null) {
                    try (InputStream is = zipFile.getInputStream(ncxEntry)) {
                        Document ncxDoc = parseXml(is);
                        List<TocItemDto> toc = parseNcxDoc(ncxDoc, hrefToSpineIndex);
                        if (!toc.isEmpty()) {
                            return toc;
                        }
                    } catch (Exception e) {
                        log.debug("NCX parse failed, falling back: {}", e.getMessage());
                    }
                }
            }

            // 3. Fallback: generate chapters directly from spine
            List<TocItemDto> fallback = new ArrayList<>();
            for (int i = 0; i < spineOrderHrefs.size(); i++) {
                String filename = spineOrderHrefs.get(i);
                String cleanName = filename.replaceFirst(".*/", "").replaceFirst("\\.[^.]+$", "");
                cleanName = cleanName.replace('_', ' ').replace('-', ' ');
                fallback.add(new TocItemDto("Kapitel " + (i + 1) + (cleanName.isBlank() ? "" : ": " + cleanName), i + 1, Collections.emptyList()));
            }
            return fallback;
        } catch (Exception e) {
            log.warn("Failed extracting outline for EPUB {}: {}", epubPath, e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Lists chapters (spine items) with their 1-based index and title.
     */
    public List<ChapterInfo> getChapters(Path epubPath) {
        List<TocItemDto> outline = extractOutline(epubPath);
        Map<Integer, String> pageTitles = new HashMap<>();
        flattenTocTitles(outline, pageTitles);

        ExtractedEpubData data = extractEpubData(epubPath);
        List<ChapterInfo> result = new ArrayList<>();
        int count = data.chapterCount();
        for (int i = 1; i <= count; i++) {
            String title = pageTitles.getOrDefault(i, "Kapitel " + i);
            result.add(new ChapterInfo(i, "chap-" + i, "chapter-" + i, title));
        }
        return result;
    }

    private void flattenTocTitles(List<TocItemDto> items, Map<Integer, String> map) {
        if (items == null) return;
        for (TocItemDto item : items) {
            if (item.pageNumber() != null && !map.containsKey(item.pageNumber())) {
                map.put(item.pageNumber(), item.title());
            }
            flattenTocTitles(item.children(), map);
        }
    }

    /**
     * Retrieves the HTML of a specific chapter (1-based index), rewriting relative resource paths
     * to `/api/documents/{id}/epub/resource?path=...`.
     */
    public String getChapterHtml(Path epubPath, int chapterIndex, UUID documentId) throws IOException {
        if (!Files.isRegularFile(epubPath)) {
            throw new FileNotFoundException("EPUB file not found: " + epubPath);
        }

        try (ZipFile zipFile = new ZipFile(epubPath.toFile(), StandardCharsets.UTF_8)) {
            String opfPath = findOpfPath(zipFile);
            if (opfPath == null) throw new IOException("OPF package not found");

            ZipEntry opfEntry = zipFile.getEntry(opfPath);
            if (opfEntry == null) throw new IOException("OPF entry not found");

            Document opfDoc;
            try (InputStream is = zipFile.getInputStream(opfEntry)) {
                opfDoc = parseXml(is);
            }

            String opfDir = getParentPath(opfPath);
            Map<String, String> manifestIdToHref = new HashMap<>();
            NodeList items = opfDoc.getElementsByTagName("item");
            for (int i = 0; i < items.getLength(); i++) {
                Element item = (Element) items.item(i);
                manifestIdToHref.put(item.getAttribute("id"), item.getAttribute("href"));
            }

            List<String> spineHrefs = new ArrayList<>();
            NodeList itemrefs = opfDoc.getElementsByTagName("itemref");
            for (int i = 0; i < itemrefs.getLength(); i++) {
                Element ir = (Element) itemrefs.item(i);
                String href = manifestIdToHref.get(ir.getAttribute("idref"));
                if (href != null) {
                    spineHrefs.add(href);
                }
            }

            if (chapterIndex < 1 || chapterIndex > spineHrefs.size()) {
                throw new IndexOutOfBoundsException("Chapter index out of range: " + chapterIndex + " (1.." + spineHrefs.size() + ")");
            }

            String chapterHref = spineHrefs.get(chapterIndex - 1);
            String fullChapterPath = resolveRelativePath(opfDir, chapterHref);
            String chapterDir = getParentPath(fullChapterPath);

            ZipEntry chapterEntry = findZipEntryIgnoreCase(zipFile, fullChapterPath);
            if (chapterEntry == null) {
                throw new FileNotFoundException("Chapter entry not found in EPUB: " + fullChapterPath);
            }

            String rawHtml;
            try (InputStream cis = zipFile.getInputStream(chapterEntry)) {
                rawHtml = new String(cis.readAllBytes(), StandardCharsets.UTF_8);
            }

            // Rewrite relative image/media references: src="..." or xlink:href="..."
            Matcher matcher = IMG_SRC_PATTERN.matcher(rawHtml);
            StringBuilder sb = new StringBuilder();
            while (matcher.find()) {
                String prefix = matcher.group(1);
                String src = matcher.group(2);
                String suffix = matcher.group(3);

                if (!src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:")) {
                    String resolvedResourcePath = resolveRelativePath(chapterDir, src);
                    String rewrittenUrl = "/api/documents/" + documentId + "/epub/resource?path=" + java.net.URLEncoder.encode(resolvedResourcePath, StandardCharsets.UTF_8);
                    matcher.appendReplacement(sb, Matcher.quoteReplacement(prefix + rewrittenUrl + suffix));
                } else {
                    matcher.appendReplacement(sb, Matcher.quoteReplacement(matcher.group(0)));
                }
            }
            matcher.appendTail(sb);

            return sb.toString();
        } catch (Exception e) {
            log.error("Failed retrieving chapter HTML: {}", e.getMessage(), e);
            throw new IOException("Failed reading chapter from EPUB: " + e.getMessage(), e);
        }
    }

    /**
     * Safely reads a raw binary resource (image, CSS, font) from an EPUB file.
     */
    public byte[] getResourceBytes(Path epubPath, String resourcePath) throws IOException {
        try (ZipFile zipFile = new ZipFile(epubPath.toFile(), StandardCharsets.UTF_8)) {
            String decodedPath = URLDecoder.decode(resourcePath, StandardCharsets.UTF_8);
            ZipEntry entry = findZipEntryIgnoreCase(zipFile, decodedPath);
            if (entry == null) {
                throw new FileNotFoundException("Resource not found in EPUB: " + resourcePath);
            }
            try (InputStream is = zipFile.getInputStream(entry)) {
                return is.readAllBytes();
            }
        }
    }

    /**
     * Determines MIME type based on file extension.
     */
    public String guessMimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".otf")) return "font/otf";
        return "application/octet-stream";
    }

    // --- Internal Helpers ---

    private String findOpfPath(ZipFile zipFile) {
        ZipEntry containerEntry = zipFile.getEntry("META-INF/container.xml");
        if (containerEntry == null) {
            containerEntry = findZipEntryIgnoreCase(zipFile, "META-INF/container.xml");
        }
        if (containerEntry == null) return null;

        try (InputStream is = zipFile.getInputStream(containerEntry)) {
            Document doc = parseXml(is);
            NodeList rootfiles = doc.getElementsByTagName("rootfile");
            for (int i = 0; i < rootfiles.getLength(); i++) {
                Element rootfile = (Element) rootfiles.item(i);
                String fullPath = rootfile.getAttribute("full-path");
                if (fullPath != null && !fullPath.isBlank()) {
                    return fullPath;
                }
            }
        } catch (Exception e) {
            log.debug("Failed parsing container.xml: {}", e.getMessage());
        }
        return null;
    }

    private String findCoverHref(Document opfDoc, ZipFile zipFile, String opfDir) {
        NodeList items = opfDoc.getElementsByTagName("item");

        // 1. Check properties="cover-image" with image media-type
        for (int i = 0; i < items.getLength(); i++) {
            Element item = (Element) items.item(i);
            String props = item.getAttribute("properties");
            String mediaType = item.getAttribute("media-type");
            if (props != null && props.contains("cover-image") && mediaType != null && mediaType.startsWith("image/")) {
                return item.getAttribute("href");
            }
        }

        // 2. Check <meta name="cover" content="..."/>
        NodeList metas = opfDoc.getElementsByTagName("meta");
        for (int i = 0; i < metas.getLength(); i++) {
            Element meta = (Element) metas.item(i);
            if ("cover".equalsIgnoreCase(meta.getAttribute("name"))) {
                String coverId = meta.getAttribute("content");
                for (int j = 0; j < items.getLength(); j++) {
                    Element item = (Element) items.item(j);
                    if (coverId.equals(item.getAttribute("id"))) {
                        String mediaType = item.getAttribute("media-type");
                        if (mediaType != null && mediaType.startsWith("image/")) {
                            return item.getAttribute("href");
                        }
                    }
                }
            }
        }

        // 3. Check item id="cover-image" or id containing "cover" (strictly matching image/ media-type)
        for (int i = 0; i < items.getLength(); i++) {
            Element item = (Element) items.item(i);
            String id = item.getAttribute("id");
            String mediaType = item.getAttribute("media-type");
            if (mediaType != null && mediaType.startsWith("image/")) {
                if ("cover-image".equalsIgnoreCase(id) || "cover".equalsIgnoreCase(id) || id.toLowerCase(Locale.ROOT).contains("cover")) {
                    return item.getAttribute("href");
                }
            }
        }

        // 4. Check image item with "cover" in href
        for (int i = 0; i < items.getLength(); i++) {
            Element item = (Element) items.item(i);
            String mediaType = item.getAttribute("media-type");
            String href = item.getAttribute("href");
            if (mediaType != null && mediaType.startsWith("image/") && href != null && href.toLowerCase(Locale.ROOT).contains("cover")) {
                return href;
            }
        }

        // 5. Check if there is an item id="cover" that is an XHTML document (e.g. cover.xhtml) and extract the img src from it
        for (int i = 0; i < items.getLength(); i++) {
            Element item = (Element) items.item(i);
            String id = item.getAttribute("id");
            String href = item.getAttribute("href");
            String mediaType = item.getAttribute("media-type");
            if ("cover".equalsIgnoreCase(id) && mediaType != null && (mediaType.contains("xhtml") || mediaType.contains("html"))) {
                String imgHref = extractImageFromCoverHtml(zipFile, opfDir, href);
                if (imgHref != null) {
                    return imgHref;
                }
            }
        }

        // 6. Check for image with "U1" or "titlepage" or "front" in href or id
        for (int i = 0; i < items.getLength(); i++) {
            Element item = (Element) items.item(i);
            String mediaType = item.getAttribute("media-type");
            String href = item.getAttribute("href");
            String id = item.getAttribute("id");
            if (mediaType != null && mediaType.startsWith("image/")) {
                String lower = (href + " " + id).toLowerCase(Locale.ROOT);
                if (lower.contains("u1") || lower.contains("titlepage") || lower.contains("front")) {
                    return href;
                }
            }
        }

        // 7. Fallback: return the first image item in the manifest
        for (int i = 0; i < items.getLength(); i++) {
            Element item = (Element) items.item(i);
            String mediaType = item.getAttribute("media-type");
            if (mediaType != null && mediaType.startsWith("image/")) {
                return item.getAttribute("href");
            }
        }

        return null;
    }

    private String extractImageFromCoverHtml(ZipFile zipFile, String opfDir, String coverHtmlHref) {
        try {
            String fullPath = resolveRelativePath(opfDir, coverHtmlHref);
            ZipEntry entry = findZipEntryIgnoreCase(zipFile, fullPath);
            if (entry == null) return null;

            String html;
            try (InputStream is = zipFile.getInputStream(entry)) {
                html = new String(is.readAllBytes(), StandardCharsets.UTF_8);
            }
            Matcher matcher = IMG_SRC_PATTERN.matcher(html);
            if (matcher.find()) {
                String src = matcher.group(2);
                String coverDir = getParentPath(fullPath);
                String resolved = resolveRelativePath(coverDir, src);
                if (!opfDir.isEmpty() && resolved.startsWith(opfDir + "/")) {
                    return resolved.substring(opfDir.length() + 1);
                }
                return resolved;
            }
        } catch (Exception e) {
            log.debug("Failed extracting image from cover HTML: {}", e.getMessage());
        }
        return null;
    }

    private String findCoverEntryInZip(ZipFile zipFile) {
        Enumeration<? extends ZipEntry> entries = zipFile.entries();
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            String name = entry.getName().toLowerCase(Locale.ROOT);
            if ((name.contains("cover") || name.contains("titlepage")) &&
                    (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".webp"))) {
                return entry.getName();
            }
        }
        return null;
    }

    private List<TocItemDto> parseNcxDoc(Document ncxDoc, Map<String, Integer> hrefToSpineIndex) {
        NodeList navMapList = ncxDoc.getElementsByTagName("navMap");
        if (navMapList.getLength() == 0) return Collections.emptyList();

        Element navMap = (Element) navMapList.item(0);
        return parseNavPoints(navMap, hrefToSpineIndex);
    }

    private List<TocItemDto> parseNavPoints(Element parent, Map<String, Integer> hrefToSpineIndex) {
        List<TocItemDto> items = new ArrayList<>();
        NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            if (children.item(i) instanceof Element elem && "navPoint".equals(elem.getTagName())) {
                String title = "Kapitel";
                NodeList textNodes = elem.getElementsByTagName("text");
                if (textNodes.getLength() > 0) {
                    title = textNodes.item(0).getTextContent().trim();
                }

                Integer pageNumber = null;
                NodeList contentNodes = elem.getElementsByTagName("content");
                if (contentNodes.getLength() > 0) {
                    String src = ((Element) contentNodes.item(0)).getAttribute("src");
                    pageNumber = resolveSpineIndex(src, hrefToSpineIndex);
                }

                List<TocItemDto> subItems = parseNavPoints(elem, hrefToSpineIndex);
                items.add(new TocItemDto(title, pageNumber, subItems));
            }
        }
        return items;
    }

    private List<TocItemDto> parseNavDoc(Document navDoc, Map<String, Integer> hrefToSpineIndex) {
        List<TocItemDto> items = new ArrayList<>();
        NodeList navElements = navDoc.getElementsByTagName("nav");
        Element tocNav = null;
        for (int i = 0; i < navElements.getLength(); i++) {
            Element nav = (Element) navElements.item(i);
            String type = nav.getAttribute("epub:type");
            if ("toc".equalsIgnoreCase(type)) {
                tocNav = nav;
                break;
            }
        }
        if (tocNav == null && navElements.getLength() > 0) {
            tocNav = (Element) navElements.item(0);
        }
        if (tocNav == null) return Collections.emptyList();

        NodeList olList = tocNav.getElementsByTagName("ol");
        if (olList.getLength() == 0) return Collections.emptyList();
        Element firstOl = (Element) olList.item(0);
        return parseOlList(firstOl, hrefToSpineIndex);
    }

    private List<TocItemDto> parseOlList(Element ol, Map<String, Integer> hrefToSpineIndex) {
        List<TocItemDto> items = new ArrayList<>();
        NodeList children = ol.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            if (children.item(i) instanceof Element li && "li".equals(li.getTagName())) {
                String title = "";
                Integer pageNumber = null;
                List<TocItemDto> subChildren = Collections.emptyList();

                NodeList aNodes = li.getElementsByTagName("a");
                if (aNodes.getLength() > 0) {
                    Element a = (Element) aNodes.item(0);
                    title = a.getTextContent().trim();
                    pageNumber = resolveSpineIndex(a.getAttribute("href"), hrefToSpineIndex);
                }

                NodeList subOls = li.getElementsByTagName("ol");
                if (subOls.getLength() > 0) {
                    subChildren = parseOlList((Element) subOls.item(0), hrefToSpineIndex);
                }

                if (!title.isBlank()) {
                    items.add(new TocItemDto(title, pageNumber, subChildren));
                }
            }
        }
        return items;
    }

    private Integer resolveSpineIndex(String href, Map<String, Integer> hrefToSpineIndex) {
        if (href == null || href.isBlank()) return null;
        String normalized = normalizeHref(href);
        return hrefToSpineIndex.get(normalized);
    }

    private String normalizeHref(String href) {
        int hashIdx = href.indexOf('#');
        String clean = hashIdx >= 0 ? href.substring(0, hashIdx) : href;
        return clean.replaceFirst("^\\./", "");
    }

    private String getTagText(Document doc, String tagName) {
        NodeList list = doc.getElementsByTagName(tagName);
        if (list.getLength() > 0) {
            String text = list.item(0).getTextContent();
            return text != null ? text.trim() : null;
        }
        // Also try local name without namespace prefix (e.g. "title" for "dc:title")
        if (tagName.contains(":")) {
            String local = tagName.substring(tagName.indexOf(':') + 1);
            list = doc.getElementsByTagName(local);
            if (list.getLength() > 0) {
                String text = list.item(0).getTextContent();
                return text != null ? text.trim() : null;
            }
        }
        return null;
    }

    private Integer parseYear(String dateStr) {
        if (dateStr == null || dateStr.isBlank()) return null;
        Matcher m = YEAR_PATTERN.matcher(dateStr);
        if (m.find()) {
            try {
                return Integer.parseInt(m.group(1));
            } catch (NumberFormatException ignored) {}
        }
        return null;
    }

    private String stripHtml(String html) {
        if (html == null || html.isBlank()) return "";
        Matcher bodyMatcher = BODY_PATTERN.matcher(html);
        String content = bodyMatcher.find() ? bodyMatcher.group(1) : html;
        String stripped = HTML_TAG_PATTERN.matcher(content).replaceAll(" ");
        // Clean unescaped entities
        stripped = stripped.replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'");
        return stripped.replaceAll("\\s+", " ").trim();
    }

    private Document parseXml(InputStream is) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(false);
        factory.setValidating(false);
        // Disable external entities for security
        try {
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        } catch (Exception ignored) {}

        DocumentBuilder builder = factory.newDocumentBuilder();
        builder.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));
        return builder.parse(is);
    }

    private String getParentPath(String path) {
        int idx = path.lastIndexOf('/');
        return idx >= 0 ? path.substring(0, idx) : "";
    }

    private String resolveRelativePath(String baseDir, String relativePath) {
        if (relativePath == null) return "";
        if (relativePath.startsWith("/")) return relativePath.substring(1);
        if (baseDir == null || baseDir.isBlank()) return relativePath;

        String combined = baseDir + "/" + relativePath;
        String[] parts = combined.split("/");
        Deque<String> stack = new ArrayDeque<>();
        for (String p : parts) {
            if (p.isEmpty() || p.equals(".")) continue;
            if (p.equals("..")) {
                if (!stack.isEmpty()) stack.removeLast();
            } else {
                stack.addLast(p);
            }
        }
        return String.join("/", stack);
    }

    private ZipEntry findZipEntryIgnoreCase(ZipFile zip, String name) {
        ZipEntry direct = zip.getEntry(name);
        if (direct != null) return direct;
        Enumeration<? extends ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements()) {
            ZipEntry e = entries.nextElement();
            if (e.getName().equalsIgnoreCase(name)) {
                return e;
            }
        }
        return null;
    }

    private BufferedImage generateSyntheticCover(String title, String author) {
        int width = 420;
        int height = 620;
        BufferedImage img = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g2 = img.createGraphics();
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);

            // Elegant gradient book cover background
            GradientPaint gp = new GradientPaint(0, 0, new Color(30, 41, 59), width, height, new Color(15, 23, 42));
            g2.setPaint(gp);
            g2.fillRect(0, 0, width, height);

            // Decorative border
            g2.setColor(new Color(148, 163, 184, 80));
            g2.setStroke(new BasicStroke(2f));
            g2.drawRect(20, 20, width - 40, height - 40);

            // EPUB badge
            g2.setColor(new Color(99, 102, 241));
            g2.fillRoundRect(35, 35, 70, 26, 8, 8);
            g2.setColor(Color.WHITE);
            g2.setFont(new Font("SansSerif", Font.BOLD, 12));
            g2.drawString("EPUB", 52, 53);

            // Title
            g2.setColor(new Color(241, 245, 249));
            g2.setFont(new Font("Serif", Font.BOLD, 24));
            FontMetrics fm = g2.getFontMetrics();
            List<String> lines = wrapText(title, fm, width - 80);
            int y = 200;
            for (String line : lines) {
                if (y > 400) break;
                g2.drawString(line, 40, y);
                y += fm.getHeight() + 4;
            }

            // Author
            g2.setColor(new Color(203, 213, 225));
            g2.setFont(new Font("SansSerif", Font.PLAIN, 16));
            g2.drawString(author, 40, height - 80);
        } finally {
            g2.dispose();
        }
        return img;
    }

    private List<String> wrapText(String text, FontMetrics fm, int maxWidth) {
        List<String> lines = new ArrayList<>();
        String[] words = text.split("\\s+");
        StringBuilder current = new StringBuilder();
        for (String w : words) {
            String test = current.length() == 0 ? w : current + " " + w;
            if (fm.stringWidth(test) <= maxWidth) {
                current = new StringBuilder(test);
            } else {
                if (current.length() > 0) lines.add(current.toString());
                current = new StringBuilder(w);
            }
        }
        if (current.length() > 0) lines.add(current.toString());
        return lines;
    }
}

