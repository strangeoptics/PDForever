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
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;

class EpubExtractionServiceTest {

    private EpubExtractionService service;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        service = new EpubExtractionService();
    }

    @Test
    void testEpubExtractionAndRendering() throws IOException {
        Path epubPath = createSampleEpub(tempDir.resolve("sample-book.epub"));

        // 1. Test Data Extraction
        EpubExtractionService.ExtractedEpubData data = service.extractEpubData(epubPath);
        assertThat(data.valid()).isTrue();
        assertThat(data.title()).isEqualTo("Test Buch Titel");
        assertThat(data.authors()).isEqualTo("Erika Mustermann");
        assertThat(data.publicationYear()).isEqualTo(2024);
        assertThat(data.chapterCount()).isEqualTo(2);
        assertThat(data.chapterTexts()).hasSize(2);
        assertThat(data.chapterTexts().get(0)).contains("Erstes Kapitel");
        assertThat(data.chapterTexts().get(1)).contains("Zweites Kapitel");

        // 2. Test TOC / Outline Extraction
        List<TocItemDto> outline = service.extractOutline(epubPath);
        assertThat(outline).hasSize(2);
        assertThat(outline.get(0).title()).isEqualTo("Kapitel 1: Der Anfang");
        assertThat(outline.get(0).pageNumber()).isEqualTo(1);
        assertThat(outline.get(1).title()).isEqualTo("Kapitel 2: Die Fortsetzung");
        assertThat(outline.get(1).pageNumber()).isEqualTo(2);

        // 3. Test Cover Image Rendering
        Path coverTarget = tempDir.resolve("cover.jpg");
        boolean coverRendered = service.renderCoverImage(epubPath, coverTarget);
        assertThat(coverRendered).isTrue();
        assertThat(Files.exists(coverTarget)).isTrue();
        assertThat(Files.size(coverTarget)).isGreaterThan(100);

        // 4. Test Chapter HTML retrieval & image URL rewriting
        UUID docId = UUID.randomUUID();
        String chapter1Html = service.getChapterHtml(epubPath, 1, docId);
        assertThat(chapter1Html).contains("/api/documents/" + docId + "/epub/resource?path=");

        // 5. Test Resource Retrieval
        byte[] resourceBytes = service.getResourceBytes(epubPath, "OEBPS/images/cover.jpg");
        assertThat(resourceBytes).isNotEmpty();
    }

    @Test
    void testRealEpubCoverExtraction() throws IOException {
        Path realPath = Path.of("storage/books/topics/identity/Der freie Mensch Die zeitgemäße Übersetzung von Atlas -- Ayn Rand -- München, 2021 -- thinkum Verlag -- 9783949522024 -- f9b114382a2bc5bf3330eae4028344dc -- Anna’s Archive.epub");
        if (!Files.exists(realPath)) {
            try (var stream = Files.walk(Path.of("storage"))) {
                realPath = stream.filter(p -> p.getFileName().toString().contains("Der freie Mensch")).findFirst().orElse(null);
            }
        }
        if (realPath != null && Files.exists(realPath)) {
            Path target = tempDir.resolve("real_cover.jpg");
            boolean rendered = service.renderCoverImage(realPath, target);
            BufferedImage img = ImageIO.read(target.toFile());
            System.out.println("Rendered: " + rendered + ", size: " + (Files.exists(target) ? Files.size(target) : 0) + ", dim: " + img.getWidth() + "x" + img.getHeight());
            assertThat(rendered).isTrue();
            assertThat(Files.exists(target)).isTrue();
        }
    }

    private Path createSampleEpub(Path path) throws IOException {
        try (ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(path.toFile()), StandardCharsets.UTF_8)) {
            // mimetype
            zos.putNextEntry(new ZipEntry("mimetype"));
            zos.write("application/epub+zip".getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();

            // META-INF/container.xml
            zos.putNextEntry(new ZipEntry("META-INF/container.xml"));
            String containerXml = """
                    <?xml version="1.0" encoding="UTF-8"?>
                    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                      <rootfiles>
                        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                      </rootfiles>
                    </container>
                    """;
            zos.write(containerXml.getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();

            // Cover image
            BufferedImage coverImg = new BufferedImage(300, 450, BufferedImage.TYPE_INT_RGB);
            Graphics2D g2 = coverImg.createGraphics();
            g2.setColor(Color.BLUE);
            g2.fillRect(0, 0, 300, 450);
            g2.dispose();
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageIO.write(coverImg, "jpg", baos);
            byte[] imgBytes = baos.toByteArray();

            zos.putNextEntry(new ZipEntry("OEBPS/images/cover.jpg"));
            zos.write(imgBytes);
            zos.closeEntry();

            // OEBPS/content.opf
            zos.putNextEntry(new ZipEntry("OEBPS/content.opf"));
            String opf = """
                    <?xml version="1.0" encoding="UTF-8"?>
                    <package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId">
                      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
                        <dc:title>Test Buch Titel</dc:title>
                        <dc:creator>Erika Mustermann</dc:creator>
                        <dc:identifier id="BookId">urn:isbn:978-3-16-148410-0</dc:identifier>
                        <dc:date>2024-05-12</dc:date>
                        <dc:description>Ein spannendes Test-Ebook.</dc:description>
                        <meta name="cover" content="cover-image"/>
                      </metadata>
                      <manifest>
                        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
                        <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>
                        <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
                        <item id="chap2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
                      </manifest>
                      <spine toc="ncx">
                        <itemref idref="chap1"/>
                        <itemref idref="chap2"/>
                      </spine>
                    </package>
                    """;
            zos.write(opf.getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();

            // OEBPS/toc.ncx
            zos.putNextEntry(new ZipEntry("OEBPS/toc.ncx"));
            String ncx = """
                    <?xml version="1.0" encoding="UTF-8"?>
                    <ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
                      <navMap>
                        <navPoint id="np-1" playOrder="1">
                          <navLabel><text>Kapitel 1: Der Anfang</text></navLabel>
                          <content src="chapter1.xhtml"/>
                        </navPoint>
                        <navPoint id="np-2" playOrder="2">
                          <navLabel><text>Kapitel 2: Die Fortsetzung</text></navLabel>
                          <content src="chapter2.xhtml"/>
                        </navPoint>
                      </navMap>
                    </ncx>
                    """;
            zos.write(ncx.getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();

            // OEBPS/chapter1.xhtml
            zos.putNextEntry(new ZipEntry("OEBPS/chapter1.xhtml"));
            String chap1 = """
                    <?xml version="1.0" encoding="UTF-8"?>
                    <!DOCTYPE html>
                    <html xmlns="http://www.w3.org/1999/xhtml">
                    <head><title>Kapitel 1</title></head>
                    <body>
                      <h1>Erstes Kapitel</h1>
                      <p>Es war ein sonniger Tag, als die Reise begann.</p>
                      <img src="images/cover.jpg" alt="Cover"/>
                    </body>
                    </html>
                    """;
            zos.write(chap1.getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();

            // OEBPS/chapter2.xhtml
            zos.putNextEntry(new ZipEntry("OEBPS/chapter2.xhtml"));
            String chap2 = """
                    <?xml version="1.0" encoding="UTF-8"?>
                    <!DOCTYPE html>
                    <html xmlns="http://www.w3.org/1999/xhtml">
                    <head><title>Kapitel 2</title></head>
                    <body>
                      <h1>Zweites Kapitel</h1>
                      <p>Die Reise ging weiter durch unbekanntes Land.</p>
                    </body>
                    </html>
                    """;
            zos.write(chap2.getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
        }
        return path;
    }
}

