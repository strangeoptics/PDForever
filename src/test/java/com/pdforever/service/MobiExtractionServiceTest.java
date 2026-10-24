package com.pdforever.service;

import com.pdforever.dto.TocItemDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class MobiExtractionServiceTest {

    private MobiExtractionService service;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        service = new MobiExtractionService();
    }

    @Test
    void testMobiExtractionAndRendering() throws IOException {
        Path mobiPath = createSampleMobi(tempDir.resolve("sample-book.mobi"));

        // 1. Data extraction
        MobiExtractionService.ExtractedMobiData data = service.extractMobiData(mobiPath);
        assertThat(data.valid()).isTrue();
        assertThat(data.title()).isEqualTo("Sherlock Holmes");
        assertThat(data.authors()).isEqualTo("Arthur Conan Doyle");
        assertThat(data.publicationYear()).isEqualTo(2021);
        assertThat(data.identifier()).isEqualTo("9781234567890");
        assertThat(data.chapterCount()).isEqualTo(2);
        assertThat(data.chapterTexts()).hasSize(2);
        assertThat(data.chapterTexts().get(0)).contains("A Study in Scarlet");
        assertThat(data.chapterTexts().get(1)).contains("The Sign of Four");

        // 2. TOC Outline extraction
        List<TocItemDto> outline = service.extractOutline(mobiPath);
        assertThat(outline).hasSize(2);
        assertThat(outline.get(0).title()).contains("A Study in Scarlet");
        assertThat(outline.get(0).pageNumber()).isEqualTo(1);
        assertThat(outline.get(1).title()).contains("The Sign of Four");
        assertThat(outline.get(1).pageNumber()).isEqualTo(2);

        // 3. Cover Image rendering
        Path coverTarget = tempDir.resolve("cover.jpg");
        boolean coverRendered = service.renderCoverImage(mobiPath, coverTarget);
        assertThat(coverRendered).isTrue();
        assertThat(Files.exists(coverTarget)).isTrue();
        assertThat(Files.size(coverTarget)).isGreaterThan(100);

        BufferedImage img = ImageIO.read(coverTarget.toFile());
        assertThat(img).isNotNull();
        assertThat(img.getWidth()).isLessThanOrEqualTo(420);

        // 4. Chapter HTML retrieval and image rewriting
        UUID docId = UUID.randomUUID();
        String html1 = service.getChapterHtml(mobiPath, 1, docId);
        assertThat(html1).contains("/api/documents/" + docId + "/mobi/resource?index=0");

        // 5. Image resource retrieval
        byte[] resourceBytes = service.getResourceBytes(mobiPath, 0);
        assertThat(resourceBytes).isNotEmpty();
        assertThat(service.guessMimeType(resourceBytes)).isEqualTo("image/jpeg");
    }

    @Test
    void testRealMobiFileDecompressionIfPresent() throws IOException {
        Path realPath = Path.of("storage/books/topics/migration/Asyl-Industrie wie Politiker, Journalisten und -- Udo K Ulfkotte.mobi");
        if (!Files.exists(realPath)) {
            return;
        }

        MobiExtractionService.ExtractedMobiData data = service.extractMobiData(realPath);
        assertThat(data.valid()).isTrue();
        assertThat(data.title()).contains("Asyl-Industrie");
        assertThat(data.authors()).contains("Ulfkotte");

        // The book has 56 TOC chapters and should now be cleanly split into chapters, not 1 giant chunk!
        assertThat(data.chapterCount()).isGreaterThanOrEqualTo(20);
        System.out.println("Extracted chapters count: " + data.chapterCount());

        List<TocItemDto> outline = service.extractOutline(realPath);
        assertThat(outline.size()).isEqualTo(data.chapterCount());
        assertThat(outline.get(0).title()).isNotBlank();
        System.out.println("TOC Chapter 1: " + outline.get(0).title());
        System.out.println("TOC Chapter 5: " + outline.get(4).title());

        String firstChapterHtml = service.getChapterHtml(realPath, 1, UUID.randomUUID());
        assertThat(firstChapterHtml).contains("Kopp Verlag, Bertha-Benz-Stra");
        assertThat(firstChapterHtml).contains("Alle Rechte vorbehalten");

        // Verify that no single chapter has almost the entire 880k book
        for (String chText : data.chapterTexts()) {
            assertThat(chText.length()).isLessThan(200_000);
        }

        // Verify that corruption artifacts from incorrect distance/length or unstripped trailers are gone
        assertThat(firstChapterHtml).doesNotContain("Dbä\"1ebequem");
        assertThat(firstChapterHtml).doesNotContain("RotburgAlRechte");
        assertThat(firstChapterHtml).doesNotContain("yl-In:\">");
    }

    private Path createSampleMobi(Path target) throws IOException {
        // Generate a sample JPEG image for cover
        BufferedImage coverImage = new BufferedImage(500, 750, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = coverImage.createGraphics();
        g.setColor(Color.DARK_GRAY);
        g.fillRect(0, 0, 500, 750);
        g.setColor(Color.WHITE);
        g.drawString("Cover Image", 50, 100);
        g.dispose();
        ByteArrayOutputStream imageBaos = new ByteArrayOutputStream();
        ImageIO.write(coverImage, "jpg", imageBaos);
        byte[] coverJpegBytes = imageBaos.toByteArray();

        // Sample text with 2 chapters separated by <mbp:pagebreak/>
        String textHtml = "<html><body>"
                + "<h1>Kapitel 1: A Study in Scarlet</h1>"
                + "<p>In the year 1878 I took my degree of Doctor of Medicine of the University of London.</p>"
                + "<img recindex=\"0\" />"
                + "<mbp:pagebreak/>"
                + "<h1>Kapitel 2: The Sign of Four</h1>"
                + "<p>Sherlock Holmes took his bottle from the corner of the mantel-piece.</p>"
                + "</body></html>";
        byte[] textBytes = textHtml.getBytes(StandardCharsets.UTF_8);

        // Compress text using simple PalmDOC literal byte chunks
        ByteArrayOutputStream compressedTextBaos = new ByteArrayOutputStream();
        int offset = 0;
        while (offset < textBytes.length) {
            int chunk = Math.min(8, textBytes.length - offset);
            compressedTextBaos.write((byte) chunk);
            compressedTextBaos.write(textBytes, offset, chunk);
            offset += chunk;
        }
        byte[] compressedText = compressedTextBaos.toByteArray();

        // Build Record 0: PalmDOC header (16 bytes) + MOBI header (116 bytes) + EXTH block
        ByteArrayOutputStream rec0Baos = new ByteArrayOutputStream();

        // PalmDOC Header (16 bytes):
        writeInt16BE(rec0Baos, 2); // compression = PalmDOC
        writeInt16BE(rec0Baos, 0); // unused
        writeInt32BE(rec0Baos, textBytes.length); // uncompressed length
        writeInt16BE(rec0Baos, 1); // textRecordCount = 1
        writeInt16BE(rec0Baos, 4096); // recordSize
        writeInt32BE(rec0Baos, 0); // currentPosition

        // MOBI Header (starts at offset 16)
        byte[] titleBytes = "Sherlock Holmes".getBytes(StandardCharsets.UTF_8);
        int mobiHeaderLength = 120;
        byte[] mobiHeader = new byte[mobiHeaderLength];
        System.arraycopy("MOBI".getBytes(StandardCharsets.US_ASCII), 0, mobiHeader, 0, 4);
        writeInt32BE(mobiHeader, 4, mobiHeaderLength);
        writeInt32BE(mobiHeader, 8, 2); // mobiType = book
        writeInt32BE(mobiHeader, 12, 65001); // textEncoding = UTF-8

        // FullName offset relative to start of record 0
        int exthStart = 16 + mobiHeaderLength;
        // EXTH block:
        ByteArrayOutputStream exthBaos = new ByteArrayOutputStream();
        exthBaos.write("EXTH".getBytes(StandardCharsets.US_ASCII));
        writeInt32BE(exthBaos, 0); // placeholder for EXTH length
        writeInt32BE(exthBaos, 5); // 5 records

        // Record 100: Author
        writeExthItem(exthBaos, 100, "Arthur Conan Doyle".getBytes(StandardCharsets.UTF_8));
        // Record 101: Publisher
        writeExthItem(exthBaos, 101, "George Newnes".getBytes(StandardCharsets.UTF_8));
        // Record 104: ISBN
        writeExthItem(exthBaos, 104, "9781234567890".getBytes(StandardCharsets.UTF_8));
        // Record 106: PubYear
        writeExthItem(exthBaos, 106, "2021".getBytes(StandardCharsets.UTF_8));
        // Record 201: CoverOffset = 0
        ByteArrayOutputStream coverOffsetBaos = new ByteArrayOutputStream();
        writeInt32BE(coverOffsetBaos, 0);
        writeExthItem(exthBaos, 201, coverOffsetBaos.toByteArray());

        byte[] exthBytes = exthBaos.toByteArray();
        // fill EXTH length
        writeInt32BE(exthBytes, 4, exthBytes.length);

        int fullNameOffset = exthStart + exthBytes.length;
        writeInt32BE(mobiHeader, 68, fullNameOffset); // fullNameOffset at byte 84 of record 0
        writeInt32BE(mobiHeader, 72, titleBytes.length); // fullNameLength at byte 88 of record 0
        writeInt32BE(mobiHeader, 92, 2); // firstImageIndex at byte 108 of record 0 -> record 2!
        writeInt32BE(mobiHeader, 112, 0x40); // exthFlags bit 6 set

        rec0Baos.write(mobiHeader);
        rec0Baos.write(exthBytes);
        rec0Baos.write(titleBytes);
        byte[] rec0Bytes = rec0Baos.toByteArray();

        // Now build PDB file with 3 records:
        // Record 0: rec0Bytes
        // Record 1: compressedText
        // Record 2: coverJpegBytes
        int numRecords = 3;
        int headerLength = 78 + (numRecords * 8) + 2; // +2 padding
        int rec0Offset = headerLength;
        int rec1Offset = rec0Offset + rec0Bytes.length;
        int rec2Offset = rec1Offset + compressedText.length;

        ByteArrayOutputStream pdbBaos = new ByteArrayOutputStream();
        byte[] dbName = new byte[32];
        byte[] nameBytes = "SherlockHolmes".getBytes(StandardCharsets.ISO_8859_1);
        System.arraycopy(nameBytes, 0, dbName, 0, nameBytes.length);
        pdbBaos.write(dbName);
        writeInt16BE(pdbBaos, 0); // attributes
        writeInt16BE(pdbBaos, 0); // version
        writeInt32BE(pdbBaos, 0); // creation date
        writeInt32BE(pdbBaos, 0); // mod date
        writeInt32BE(pdbBaos, 0); // backup date
        writeInt32BE(pdbBaos, 0); // mod num
        writeInt32BE(pdbBaos, 0); // app info
        writeInt32BE(pdbBaos, 0); // sort info
        pdbBaos.write("BOOK".getBytes(StandardCharsets.US_ASCII)); // type
        pdbBaos.write("MOBI".getBytes(StandardCharsets.US_ASCII)); // creator
        writeInt32BE(pdbBaos, 0); // unique id seed
        writeInt32BE(pdbBaos, 0); // next record list
        writeInt16BE(pdbBaos, numRecords); // num records

        // Record entries (8 bytes each):
        writeRecordEntry(pdbBaos, rec0Offset);
        writeRecordEntry(pdbBaos, rec1Offset);
        writeRecordEntry(pdbBaos, rec2Offset);
        writeInt16BE(pdbBaos, 0); // 2 padding bytes

        // Record contents
        pdbBaos.write(rec0Bytes);
        pdbBaos.write(compressedText);
        pdbBaos.write(coverJpegBytes);

        try (FileOutputStream fos = new FileOutputStream(target.toFile())) {
            fos.write(pdbBaos.toByteArray());
        }
        return target;
    }

    private void writeRecordEntry(ByteArrayOutputStream out, int offset) {
        writeInt32BE(out, offset);
        out.write(0); // attributes
        out.write(0); // unique ID 1
        out.write(0); // unique ID 2
        out.write(0); // unique ID 3
    }

    private void writeExthItem(ByteArrayOutputStream out, int type, byte[] data) {
        writeInt32BE(out, type);
        writeInt32BE(out, data.length + 8);
        out.write(data, 0, data.length);
    }

    private void writeInt16BE(ByteArrayOutputStream out, int val) {
        out.write((val >> 8) & 0xFF);
        out.write(val & 0xFF);
    }

    private void writeInt32BE(ByteArrayOutputStream out, int val) {
        out.write((val >> 24) & 0xFF);
        out.write((val >> 16) & 0xFF);
        out.write((val >> 8) & 0xFF);
        out.write(val & 0xFF);
    }

    private void writeInt32BE(byte[] b, int offset, int val) {
        b[offset] = (byte) ((val >> 24) & 0xFF);
        b[offset + 1] = (byte) ((val >> 16) & 0xFF);
        b[offset + 2] = (byte) ((val >> 8) & 0xFF);
        b[offset + 3] = (byte) (val & 0xFF);
    }
}

