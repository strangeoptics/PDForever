package com.pdforever.service;

import com.pdforever.dto.TocItemDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class MobiExtractionService {

    private static final Logger log = LoggerFactory.getLogger(MobiExtractionService.class);
    private static final int MAX_COVER_WIDTH = 420;

    private static final Pattern HTML_TAG_PATTERN = Pattern.compile("<[^>]*>", Pattern.DOTALL);
    private static final Pattern HEADINGS_PATTERN = Pattern.compile("<h[1-3][^>]*>(.*?)</h[1-3]>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern YEAR_PATTERN = Pattern.compile("\\b(18\\d{2}|19\\d{2}|20\\d{2})\\b");
    private static final Pattern PAGEBREAK_PATTERN = Pattern.compile("(?i)<(?:mbp:)?pagebreak[^>]*>");
    private static final Pattern HEADING_SPLIT_PATTERN = Pattern.compile("(?i)(?=<h[12][^>]*>)");
    private static final Pattern PARAGRAPH_SPLIT_PATTERN = Pattern.compile("(?i)(?<=</p>)");
    private static final Pattern FILEPOS_LINK_PATTERN = Pattern.compile(
            "(?i)<a\\s+[^>]*?(?:filepos=[\"']?|href=[\"']?#filepos)(\\d+)[\"']?[^>]*>(.*?)</a>",
            Pattern.DOTALL
    );

    public record MobiChapter(String title, String html) {
    }

    public record ExtractedMobiData(
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

    public boolean isMobiOrAzwFile(Path path) {
        if (path == null || path.getFileName() == null) return false;
        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
        return name.endsWith(".mobi") || name.endsWith(".azw") || name.endsWith(".azw3") || name.endsWith(".prc");
    }

    /**
     * Extracts metadata and chapter texts from a MOBI/AZW file for Lucene indexing and cataloging.
     */
    public ExtractedMobiData extractMobiData(Path mobiPath) {
        if (!Files.isRegularFile(mobiPath)) {
            return new ExtractedMobiData(0, Collections.emptyList(), null, null, null, null, null, false);
        }

        try {
            byte[] fileBytes = Files.readAllBytes(mobiPath);
            PdbFile pdb = new PdbFile(fileBytes);
            if (!pdb.isValid()) {
                return new ExtractedMobiData(0, Collections.emptyList(), null, null, null, null, null, false);
            }

            MobiHeader mobiHeader = parseMobiHeader(pdb);
            if (mobiHeader == null) {
                return new ExtractedMobiData(0, Collections.emptyList(), null, null, null, null, null, false);
            }

            String fullTextHtml = decompressText(pdb, mobiHeader);
            List<MobiChapter> chapters = splitIntoChaptersWithTitles(fullTextHtml);

            List<String> chapterTexts = new ArrayList<>();
            for (MobiChapter ch : chapters) {
                String plain = stripHtml(ch.html()).trim();
                if (!plain.isBlank()) {
                    chapterTexts.add(plain);
                }
            }

            if (chapterTexts.isEmpty() && !fullTextHtml.isBlank()) {
                chapterTexts.add(stripHtml(fullTextHtml).trim());
            }

            return new ExtractedMobiData(
                    Math.max(1, chapterTexts.size()),
                    chapterTexts,
                    mobiHeader.title,
                    mobiHeader.author,
                    mobiHeader.isbn,
                    mobiHeader.pubYear,
                    mobiHeader.description,
                    true
            );

        } catch (Exception e) {
            log.error("Failed extracting MOBI data from {}: {}", mobiPath, e.getMessage(), e);
            return new ExtractedMobiData(0, Collections.emptyList(), null, null, null, null, null, false);
        }
    }

    /**
     * Extracts outline / table of contents for navigation.
     */
    public List<TocItemDto> extractOutline(Path mobiPath) {
        List<ChapterInfo> chapters = getChapters(mobiPath);
        List<TocItemDto> outline = new ArrayList<>();
        for (ChapterInfo ch : chapters) {
            outline.add(new TocItemDto(ch.title(), ch.index(), Collections.emptyList()));
        }
        return outline;
    }

    /**
     * Returns the list of chapters with titles and 1-based indices.
     */
    public List<ChapterInfo> getChapters(Path mobiPath) {
        if (!Files.isRegularFile(mobiPath)) {
            return Collections.emptyList();
        }

        try {
            byte[] fileBytes = Files.readAllBytes(mobiPath);
            PdbFile pdb = new PdbFile(fileBytes);
            MobiHeader mobiHeader = parseMobiHeader(pdb);
            if (mobiHeader == null) return Collections.emptyList();

            String fullTextHtml = decompressText(pdb, mobiHeader);
            List<MobiChapter> chapters = splitIntoChaptersWithTitles(fullTextHtml);

            List<ChapterInfo> list = new ArrayList<>();
            for (int i = 0; i < chapters.size(); i++) {
                int chapterNum = i + 1;
                String title = chapters.get(i).title();
                list.add(new ChapterInfo(chapterNum, "chapter-" + chapterNum, "chapter-" + chapterNum, title));
            }
            return list;

        } catch (Exception e) {
            log.error("Failed reading MOBI chapters from {}: {}", mobiPath, e.getMessage(), e);
            return Collections.emptyList();
        }
    }

    /**
     * Returns chapter HTML with image URLs rewritten to point to /api/documents/{id}/mobi/resource?index=...
     */
    public String getChapterHtml(Path mobiPath, int chapterIndex, UUID docId) throws IOException {
        byte[] fileBytes = Files.readAllBytes(mobiPath);
        PdbFile pdb = new PdbFile(fileBytes);
        MobiHeader mobiHeader = parseMobiHeader(pdb);
        if (mobiHeader == null) {
            return "<div style=\"padding:2rem;\">Kapitel konnte nicht geladen werden.</div>";
        }

        String fullTextHtml = decompressText(pdb, mobiHeader);
        List<MobiChapter> chapters = splitIntoChaptersWithTitles(fullTextHtml);

        int targetIdx = chapterIndex - 1;
        String chapterHtml;
        if (targetIdx >= 0 && targetIdx < chapters.size()) {
            chapterHtml = chapters.get(targetIdx).html();
        } else if (!chapters.isEmpty()) {
            chapterHtml = chapters.get(0).html();
        } else {
            chapterHtml = fullTextHtml;
        }

        return rewriteImageUrls(chapterHtml, docId);
    }

    /**
     * Retrieves raw image bytes for an image index referenced in the MOBI document.
     */
    public byte[] getResourceBytes(Path mobiPath, int imageIndex) throws IOException {
        byte[] fileBytes = Files.readAllBytes(mobiPath);
        PdbFile pdb = new PdbFile(fileBytes);
        MobiHeader mobiHeader = parseMobiHeader(pdb);
        if (mobiHeader == null || mobiHeader.firstImageIndex < 0) {
            return new byte[0];
        }

        // Try direct record offset or 1-based index relative to firstImageIndex
        int targetRecord = mobiHeader.firstImageIndex + imageIndex;
        if (targetRecord >= pdb.getNumRecords()) {
            targetRecord = mobiHeader.firstImageIndex + Math.max(0, imageIndex - 1);
        }

        if (targetRecord >= 0 && targetRecord < pdb.getNumRecords()) {
            byte[] rec = pdb.getRecord(targetRecord);
            if (rec != null && isImageBytes(rec)) {
                return rec;
            }
        }

        // Fallback: search nearby records for valid image bytes
        for (int i = mobiHeader.firstImageIndex; i < pdb.getNumRecords(); i++) {
            byte[] rec = pdb.getRecord(i);
            if (rec != null && isImageBytes(rec)) {
                if (imageIndex <= 1 || i == mobiHeader.firstImageIndex + imageIndex) {
                    return rec;
                }
            }
        }

        return new byte[0];
    }

    /**
     * Extracts and renders the cover image of a MOBI/AZW file scaled to 420px max width.
     */
    public boolean renderCoverImage(Path mobiPath, Path targetFile) {
        if (!Files.isRegularFile(mobiPath)) {
            return false;
        }

        try {
            byte[] fileBytes = Files.readAllBytes(mobiPath);
            PdbFile pdb = new PdbFile(fileBytes);
            MobiHeader mobiHeader = parseMobiHeader(pdb);
            if (mobiHeader == null) {
                return false;
            }

            byte[] imageBytes = findCoverImageBytes(pdb, mobiHeader);
            if (imageBytes == null || imageBytes.length == 0) {
                return false;
            }

            BufferedImage original = ImageIO.read(new ByteArrayInputStream(imageBytes));
            if (original == null) {
                return false;
            }

            int origWidth = original.getWidth();
            int origHeight = original.getHeight();
            if (origWidth <= 0 || origHeight <= 0) {
                return false;
            }

            int targetWidth = Math.min(MAX_COVER_WIDTH, origWidth);
            int targetHeight = (int) Math.round((double) origHeight * targetWidth / origWidth);

            BufferedImage scaled = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB);
            Graphics2D g2d = scaled.createGraphics();
            try {
                g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                g2d.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
                g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g2d.drawImage(original, 0, 0, targetWidth, targetHeight, null);
            } finally {
                g2d.dispose();
            }

            if (targetFile.getParent() != null) {
                Files.createDirectories(targetFile.getParent());
            }

            return ImageIO.write(scaled, "jpg", targetFile.toFile());

        } catch (Exception e) {
            log.warn("Could not render cover image for MOBI {}: {}", mobiPath, e.getMessage());
            return false;
        }
    }

    public String guessMimeType(byte[] imageBytes) {
        if (imageBytes == null || imageBytes.length < 4) return "application/octet-stream";
        if ((imageBytes[0] & 0xFF) == 0xFF && (imageBytes[1] & 0xFF) == 0xD8) return "image/jpeg";
        if (imageBytes[0] == (byte) 0x89 && imageBytes[1] == 'P' && imageBytes[2] == 'N' && imageBytes[3] == 'G') return "image/png";
        if (imageBytes[0] == 'G' && imageBytes[1] == 'I' && imageBytes[2] == 'F') return "image/gif";
        return "image/jpeg";
    }

    private boolean isImageBytes(byte[] bytes) {
        if (bytes == null || bytes.length < 4) return false;
        return ((bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xD8) // JPEG
                || (bytes[0] == (byte) 0x89 && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G') // PNG
                || (bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F'); // GIF
    }

    private byte[] findCoverImageBytes(PdbFile pdb, MobiHeader mobiHeader) {
        // 1. If EXTH tag 201 CoverOffset is present
        if (mobiHeader.coverOffset >= 0 && mobiHeader.firstImageIndex >= 0) {
            int coverRecord = mobiHeader.firstImageIndex + mobiHeader.coverOffset;
            if (coverRecord < pdb.getNumRecords()) {
                byte[] rec = pdb.getRecord(coverRecord);
                if (isImageBytes(rec)) return rec;
            }
        }

        // 2. Try firstImageIndex
        if (mobiHeader.firstImageIndex >= 0 && mobiHeader.firstImageIndex < pdb.getNumRecords()) {
            byte[] rec = pdb.getRecord(mobiHeader.firstImageIndex);
            if (isImageBytes(rec)) return rec;
        }

        // 3. Scan first few image records for the largest image (often the cover)
        byte[] best = null;
        int maxLen = 0;
        int start = Math.max(0, mobiHeader.firstImageIndex);
        int end = Math.min(pdb.getNumRecords(), start + 10);
        for (int i = start; i < end; i++) {
            byte[] rec = pdb.getRecord(i);
            if (isImageBytes(rec) && rec.length > maxLen) {
                maxLen = rec.length;
                best = rec;
            }
        }
        return best;
    }

    private String rewriteImageUrls(String html, UUID docId) {
        if (html == null) return "";

        // 1. Match <img ... recindex="123" ...>
        Pattern recPattern = Pattern.compile("(<img[^>]+)recindex=[\"'](\\d+)[\"']", Pattern.CASE_INSENSITIVE);
        Matcher recMatcher = recPattern.matcher(html);
        StringBuffer sb = new StringBuffer();
        while (recMatcher.find()) {
            String prefix = recMatcher.group(1);
            String idxStr = recMatcher.group(2);
            recMatcher.appendReplacement(sb, prefix + "src=\"/api/documents/" + docId + "/mobi/resource?index=" + idxStr + "\"");
        }
        recMatcher.appendTail(sb);
        String step1 = sb.toString();

        // 2. Match <img ... src="kindle:embed:0001" ...>
        Pattern kindlePattern = Pattern.compile("(<img[^>]+src=[\"'])kindle:embed:0*(\\d+)[^\"']*([\"'])", Pattern.CASE_INSENSITIVE);
        Matcher kindleMatcher = kindlePattern.matcher(step1);
        StringBuffer sb2 = new StringBuffer();
        while (kindleMatcher.find()) {
            String prefix = kindleMatcher.group(1);
            String idxStr = kindleMatcher.group(2);
            String quote = kindleMatcher.group(3);
            kindleMatcher.appendReplacement(sb2, prefix + "/api/documents/" + docId + "/mobi/resource?index=" + idxStr + quote);
        }
        kindleMatcher.appendTail(sb2);

        return sb2.toString();
    }

    public List<MobiChapter> splitIntoChaptersWithTitles(String fullTextHtml) {
        if (fullTextHtml == null || fullTextHtml.isBlank()) {
            return Collections.emptyList();
        }

        // 1. Try splitting using internal MOBI Table of Contents (filepos references)
        List<MobiChapter> fileposChapters = splitByFileposToc(fullTextHtml);
        if (fileposChapters.size() >= 3) {
            return fileposChapters;
        }

        // 2. Try splitting by <mbp:pagebreak> if it produces balanced chunks
        if (PAGEBREAK_PATTERN.matcher(fullTextHtml).find()) {
            String[] parts = PAGEBREAK_PATTERN.split(fullTextHtml);
            List<String> list = new ArrayList<>();
            int maxPartLen = 0;
            for (String p : parts) {
                if (!p.strip().isBlank()) {
                    list.add(p.strip());
                    maxPartLen = Math.max(maxPartLen, p.length());
                }
            }
            // Only accept pagebreak split if it doesn't leave a single giant un-split block
            if (list.size() > 1 && (list.size() >= 4 || maxPartLen < 150_000)) {
                List<MobiChapter> chapters = new ArrayList<>();
                for (int i = 0; i < list.size(); i++) {
                    int num = i + 1;
                    chapters.add(new MobiChapter(extractChapterTitle(list.get(i), num), list.get(i)));
                }
                return chapters;
            }
        }

        // 3. Try splitting by <h1> or <h2> headings
        if (HEADING_SPLIT_PATTERN.matcher(fullTextHtml).find()) {
            String[] parts = HEADING_SPLIT_PATTERN.split(fullTextHtml);
            List<String> list = new ArrayList<>();
            for (String p : parts) {
                if (!p.strip().isBlank()) list.add(p.strip());
            }
            if (list.size() > 1) {
                List<MobiChapter> chapters = new ArrayList<>();
                for (int i = 0; i < list.size(); i++) {
                    int num = i + 1;
                    chapters.add(new MobiChapter(extractChapterTitle(list.get(i), num), list.get(i)));
                }
                return chapters;
            }
        }

        // 4. Fallback: split long text into reasonable ~7000 character chunks at </p> boundaries
        if (fullTextHtml.length() > 10000) {
            List<MobiChapter> chunks = new ArrayList<>();
            String[] paragraphs = PARAGRAPH_SPLIT_PATTERN.split(fullTextHtml);
            StringBuilder current = new StringBuilder();
            int chunkIdx = 1;
            for (String p : paragraphs) {
                current.append(p);
                if (current.length() >= 7000) {
                    String text = current.toString().strip();
                    chunks.add(new MobiChapter("Teil " + chunkIdx++, text));
                    current.setLength(0);
                }
            }
            if (current.length() > 0 && !current.toString().strip().isBlank()) {
                chunks.add(new MobiChapter("Teil " + chunkIdx, current.toString().strip()));
            }
            if (chunks.size() > 1) return chunks;
        }

        return List.of(new MobiChapter("Buchinhalt", fullTextHtml.strip()));
    }

    private List<MobiChapter> splitByFileposToc(String fullTextHtml) {
        Matcher m = FILEPOS_LINK_PATTERN.matcher(fullTextHtml);
        Map<Integer, String> tocMap = new TreeMap<>();
        while (m.find()) {
            try {
                int pos = Integer.parseInt(m.group(1));
                if (pos < 0 || pos >= fullTextHtml.length()) continue;
                String rawTitle = stripHtml(m.group(2)).trim()
                        .replaceAll("[.\\s]+$", ""); // Remove trailing dots/whitespace
                if (!rawTitle.isBlank() && !rawTitle.matches("^\\d+$") && rawTitle.length() <= 120) {
                    tocMap.putIfAbsent(pos, rawTitle);
                }
            } catch (NumberFormatException ignored) {}
        }

        if (tocMap.size() < 3) {
            return Collections.emptyList();
        }

        // Filter out entries that are too close to each other (< 200 chars apart)
        List<Map.Entry<Integer, String>> filtered = new ArrayList<>();
        int lastPos = -1;
        for (Map.Entry<Integer, String> entry : tocMap.entrySet()) {
            int pos = entry.getKey();
            if (lastPos < 0 || pos - lastPos >= 200) {
                filtered.add(entry);
                lastPos = pos;
            }
        }

        if (filtered.size() < 3) {
            return Collections.emptyList();
        }

        List<MobiChapter> result = new ArrayList<>();

        // Handle front matter before first entry if it starts after offset 300
        int firstPos = filtered.get(0).getKey();
        if (firstPos > 300) {
            String frontHtml = fullTextHtml.substring(0, firstPos).strip();
            if (!frontHtml.isBlank()) {
                result.add(new MobiChapter("Titelseite / Einleitung", frontHtml));
            }
        }

        for (int i = 0; i < filtered.size(); i++) {
            int start = (i == 0 && firstPos <= 300) ? 0 : filtered.get(i).getKey();
            int end = (i + 1 < filtered.size()) ? filtered.get(i + 1).getKey() : fullTextHtml.length();
            if (start >= fullTextHtml.length() || start >= end) continue;

            String chapterHtml = fullTextHtml.substring(start, Math.min(end, fullTextHtml.length())).strip();
            if (!chapterHtml.isBlank()) {
                String title = filtered.get(i).getValue();
                result.add(new MobiChapter(title, chapterHtml));
            }
        }

        return result;
    }

    private String extractChapterTitle(String html, int chapterNum) {
        Matcher m = HEADINGS_PATTERN.matcher(html);
        if (m.find()) {
            String title = stripHtml(m.group(1)).trim();
            if (!title.isBlank() && title.length() <= 120) {
                return title;
            }
        }
        return "Kapitel " + chapterNum;
    }

    private String stripHtml(String html) {
        if (html == null) return "";
        return HTML_TAG_PATTERN.matcher(html).replaceAll(" ")
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replaceAll("\\s+", " ")
                .trim();
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

    private String decompressText(PdbFile pdb, MobiHeader header) {
        ByteArrayOutputStream fullStream = new ByteArrayOutputStream();
        int textRecordCount = Math.min(header.textRecordCount, pdb.getNumRecords() - 1);

        for (int i = 1; i <= textRecordCount; i++) {
            byte[] record = pdb.getRecord(i);
            if (record == null) continue;

            byte[] toDecompress = record;
            if (header.extraFlags != 0) {
                int trailing = getSizeOfTrailingDataEntries(record, header.extraFlags);
                if (trailing > 0 && trailing < record.length) {
                    toDecompress = Arrays.copyOf(record, record.length - trailing);
                }
            }

            byte[] decompressed;
            if (header.compression == 1) {
                decompressed = toDecompress;
            } else if (header.compression == 2) {
                decompressed = decompressPalmDoc(toDecompress);
            } else {
                decompressed = toDecompress;
            }
            fullStream.write(decompressed, 0, decompressed.length);
        }

        Charset charset = (header.textEncoding == 65001) ? StandardCharsets.UTF_8 : Charset.forName("windows-1252");
        return new String(fullStream.toByteArray(), charset);
    }

    private static int getSizeOfTrailingDataEntries(byte[] ptr, int flags) {
        int num = 0;
        int size = ptr.length;
        int testflags = flags >> 1;
        while (testflags != 0) {
            if ((testflags & 1) != 0) {
                num += getSizeOfTrailingDataEntry(ptr, size - num);
            }
            testflags >>= 1;
        }
        if ((flags & 1) != 0 && size - num > 0) {
            num += (ptr[size - num - 1] & 0x03) + 1;
        }
        return Math.min(num, size);
    }

    private static int getSizeOfTrailingDataEntry(byte[] ptr, int size) {
        int bitpos = 0;
        int result = 0;
        if (size <= 0) return 0;
        while (true) {
            int v = ptr[size - 1] & 0xFF;
            result |= (v & 0x7F) << bitpos;
            bitpos += 7;
            size--;
            if ((v & 0x80) != 0 || bitpos >= 28 || size == 0) {
                return result;
            }
        }
    }

    /**
     * PalmDOC LZ77-variant decompression algorithm.
     */
    public static byte[] decompressPalmDoc(byte[] src) {
        if (src == null || src.length == 0) return new byte[0];

        // Allocate expandable buffer
        byte[] buffer = new byte[Math.max(4096, src.length * 2)];
        int outLen = 0;
        int i = 0;

        while (i < src.length) {
            int b = src[i++] & 0xFF;

            if (b == 0x00) {
                if (outLen >= buffer.length) buffer = Arrays.copyOf(buffer, buffer.length * 2);
                buffer[outLen++] = 0;
            } else if (b >= 0x01 && b <= 0x08) {
                // Copy literal 1..8 bytes
                int count = b;
                while (count-- > 0 && i < src.length) {
                    if (outLen >= buffer.length) buffer = Arrays.copyOf(buffer, buffer.length * 2);
                    buffer[outLen++] = src[i++];
                }
            } else if (b <= 0x7F) {
                // Literal byte
                if (outLen >= buffer.length) buffer = Arrays.copyOf(buffer, buffer.length * 2);
                buffer[outLen++] = (byte) b;
            } else if (b <= 0xBF) {
                // Distance & length back-reference
                if (i < src.length) {
                    int b2 = src[i++] & 0xFF;
                    int combined = ((b & 0x3F) << 8) | b2;
                    int distance = combined >> 3;
                    int length = (combined & 0x07) + 3;

                    if (distance > 0 && distance <= outLen) {
                        for (int k = 0; k < length; k++) {
                            if (outLen >= buffer.length) {
                                buffer = Arrays.copyOf(buffer, buffer.length * 2);
                            }
                            buffer[outLen] = buffer[outLen - distance];
                            outLen++;
                        }
                    }
                }
            } else {
                // 0xC0 .. 0xFF: space + char with bit 7 cleared
                if (outLen + 2 > buffer.length) buffer = Arrays.copyOf(buffer, buffer.length * 2);
                buffer[outLen++] = ' ';
                buffer[outLen++] = (byte) (b ^ 0x80);
            }
        }

        return Arrays.copyOf(buffer, outLen);
    }

    private MobiHeader parseMobiHeader(PdbFile pdb) {
        byte[] rec0 = pdb.getRecord(0);
        if (rec0 == null || rec0.length < 16) return null;

        MobiHeader header = new MobiHeader();
        header.compression = readInt16BE(rec0, 0);
        header.textLength = readInt32BE(rec0, 4);
        header.textRecordCount = readInt16BE(rec0, 8);
        header.recordSize = readInt16BE(rec0, 10);

        if (rec0.length < 40) return header;
        String magic = new String(rec0, 16, 4, StandardCharsets.US_ASCII);
        if (!"MOBI".equals(magic)) {
            // PalmDOC without MOBI header
            header.title = pdb.getDbName();
            return header;
        }

        int mobiHeaderLength = readInt32BE(rec0, 20);
        header.textEncoding = (rec0.length >= 32) ? readInt32BE(rec0, 28) : 1252;
        Charset charset = (header.textEncoding == 65001) ? StandardCharsets.UTF_8 : Charset.forName("windows-1252");

        if (rec0.length >= 92) {
            int fullNameOffset = readInt32BE(rec0, 84);
            int fullNameLength = readInt32BE(rec0, 88);
            if (fullNameOffset > 0 && fullNameLength > 0 && fullNameOffset + fullNameLength <= rec0.length) {
                header.title = new String(rec0, fullNameOffset, fullNameLength, charset).trim();
            }
        }
        if (header.title == null || header.title.isBlank()) {
            header.title = pdb.getDbName();
        }

        if (rec0.length >= 112) {
            header.firstImageIndex = readInt32BE(rec0, 108);
        }

        if (rec0.length >= 0xF4 && mobiHeaderLength >= 0xE4) {
            header.extraFlags = readInt16BE(rec0, 0xF2);
        }

        int exthFlags = (rec0.length >= 132) ? readInt32BE(rec0, 128) : 0;
        if ((exthFlags & 0x40) != 0 && rec0.length >= 16 + mobiHeaderLength + 12) {
            parseExthHeader(rec0, 16 + mobiHeaderLength, header);
        }

        return header;
    }

    private void parseExthHeader(byte[] rec0, int exthStart, MobiHeader header) {
        if (exthStart + 12 > rec0.length) return;
        String magic = new String(rec0, exthStart, 4, StandardCharsets.US_ASCII);
        if (!"EXTH".equals(magic)) return;

        int recordCount = readInt32BE(rec0, exthStart + 8);
        int cur = exthStart + 12;

        for (int i = 0; i < recordCount && cur + 8 <= rec0.length; i++) {
            int recType = readInt32BE(rec0, cur);
            int recLen = readInt32BE(rec0, cur + 4);
            if (recLen < 8 || cur + recLen > rec0.length) break;

            byte[] data = Arrays.copyOfRange(rec0, cur + 8, cur + recLen);
            switch (recType) {
                case 100 -> header.author = new String(data, StandardCharsets.UTF_8).trim();
                case 101 -> header.publisher = new String(data, StandardCharsets.UTF_8).trim();
                case 103 -> header.description = new String(data, StandardCharsets.UTF_8).trim();
                case 104 -> header.isbn = new String(data, StandardCharsets.UTF_8).trim();
                case 106 -> header.pubYear = parseYear(new String(data, StandardCharsets.UTF_8).trim());
                case 201 -> {
                    if (data.length == 4) {
                        header.coverOffset = readInt32BE(data, 0);
                    } else if (data.length > 0) {
                        try {
                            header.coverOffset = Integer.parseInt(new String(data, StandardCharsets.US_ASCII).trim());
                        } catch (NumberFormatException ignored) {}
                    }
                }
                case 503 -> {
                    String updatedTitle = new String(data, StandardCharsets.UTF_8).trim();
                    if (!updatedTitle.isBlank()) {
                        header.title = updatedTitle;
                    }
                }
            }
            cur += recLen;
        }
    }

    private static int readInt16BE(byte[] b, int offset) {
        if (offset + 2 > b.length) return 0;
        return ((b[offset] & 0xFF) << 8) | (b[offset + 1] & 0xFF);
    }

    private static int readInt32BE(byte[] b, int offset) {
        if (offset + 4 > b.length) return 0;
        return ((b[offset] & 0xFF) << 24)
                | ((b[offset + 1] & 0xFF) << 16)
                | ((b[offset + 2] & 0xFF) << 8)
                | (b[offset + 3] & 0xFF);
    }

    private static class MobiHeader {
        int compression;
        int textLength;
        int textRecordCount;
        int recordSize;
        int textEncoding = 1252;
        String title;
        String author;
        String publisher;
        String description;
        String isbn;
        Integer pubYear;
        int firstImageIndex = -1;
        int coverOffset = -1;
        int extraFlags = 0;
    }

    public static class PdbFile {
        private final byte[] fileBytes;
        private final String dbName;
        private final int numRecords;
        private final int[] recordOffsets;

        public PdbFile(byte[] fileBytes) {
            this.fileBytes = fileBytes != null ? fileBytes : new byte[0];
            if (this.fileBytes.length >= 78) {
                int nameEnd = 0;
                while (nameEnd < 32 && this.fileBytes[nameEnd] != 0) {
                    nameEnd++;
                }
                this.dbName = new String(this.fileBytes, 0, nameEnd, StandardCharsets.ISO_8859_1);
                this.numRecords = readInt16BE(this.fileBytes, 76);
                this.recordOffsets = new int[this.numRecords];
                for (int i = 0; i < this.numRecords; i++) {
                    int entryOffset = 78 + (i * 8);
                    if (entryOffset + 4 <= this.fileBytes.length) {
                        this.recordOffsets[i] = readInt32BE(this.fileBytes, entryOffset);
                    }
                }
            } else {
                this.dbName = "";
                this.numRecords = 0;
                this.recordOffsets = new int[0];
            }
        }

        public boolean isValid() {
            return fileBytes.length >= 78 && numRecords > 0;
        }

        public String getDbName() {
            return dbName;
        }

        public int getNumRecords() {
            return numRecords;
        }

        public byte[] getRecord(int index) {
            if (index < 0 || index >= numRecords) return null;
            int start = recordOffsets[index];
            if (start < 0 || start >= fileBytes.length) return null;
            int end = (index + 1 < numRecords) ? recordOffsets[index + 1] : fileBytes.length;
            if (end < start || end > fileBytes.length) {
                end = fileBytes.length;
            }
            return Arrays.copyOfRange(fileBytes, start, end);
        }
    }
}

