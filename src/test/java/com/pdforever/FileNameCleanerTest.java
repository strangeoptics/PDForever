package com.pdforever;

import com.pdforever.config.LibraryProperties;
import com.pdforever.service.FileNameCleaner;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FileNameCleanerTest {

    private FileNameCleaner cleaner;

    @BeforeEach
    void setUp() {
        LibraryProperties properties = new LibraryProperties(
                Path.of("./storage"),
                Path.of("./data/lucene-index"),
                Path.of("./data/covers"),
                500L,
                false,
                List.of("_de.downmagaz.net", "de.downmagaz.net", "downmagaz.net"),
                List.of("(?<=\\b(?:18|19|20)\\d{2})\\s*--.*$"),
                new LibraryProperties.RagProperties(true, "http://localhost:11434", "qwen2.5:14b", 8)
        );
        cleaner = new FileNameCleaner(properties);
    }

    @Test
    void testCleanFileNameRemovesLiterals() {
        String raw = "Outdoor_1.24_de.downmagaz.net.pdf";
        String cleaned = cleaner.cleanFileName(raw);
        assertThat(cleaned).isEqualTo("Outdoor_1.24.pdf");
    }

    @Test
    void testIsJunkOrAdTitleDetectsDomainNames() {
        assertThat(cleaner.isJunkOrAdTitle("de.downmagaz.net")).isTrue();
        assertThat(cleaner.isJunkOrAdTitle("www.downmagaz.net")).isTrue();
        assertThat(cleaner.isJunkOrAdTitle("https://downmagaz.net")).isTrue();
        assertThat(cleaner.isJunkOrAdTitle("outdoor.com")).isTrue();
        assertThat(cleaner.isJunkOrAdTitle("untitled")).isTrue();
        assertThat(cleaner.isJunkOrAdTitle("Microsoft Word - Doc1")).isTrue();
        assertThat(cleaner.isJunkOrAdTitle("Outdoor_1.24.pdf")).isTrue();
    }

    @Test
    void testIsJunkOrAdTitleAllowsValidTitles() {
        assertThat(cleaner.isJunkOrAdTitle("Outdoor Magazin")).isFalse();
        assertThat(cleaner.isJunkOrAdTitle("Deep Learning and Neural Networks")).isFalse();
        assertThat(cleaner.isJunkOrAdTitle("The Pragmatic Programmer")).isFalse();
    }

    @Test
    void testCleanTitleRemovesLiteralsFromEmbeddedTitle() {
        String titleWithWatermark = "Outdoor Magazin _de.downmagaz.net";
        String cleaned = cleaner.cleanTitle(titleWithWatermark);
        assertThat(cleaned).isEqualTo("Outdoor Magazin");

        String pureAdTitle = "de.downmagaz.net";
        assertThat(cleaner.cleanTitle(pureAdTitle)).isNull();
    }
}
