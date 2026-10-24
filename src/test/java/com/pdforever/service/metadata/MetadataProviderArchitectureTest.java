package com.pdforever.service.metadata;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pdforever.domain.Document;
import com.pdforever.service.FileNameCleaner;
import com.pdforever.service.MetadataEnrichmentService;
import com.pdforever.service.metadata.provider.CrossRefMetadataProvider;
import com.pdforever.service.metadata.provider.OpenLibraryMetadataProvider;
import com.pdforever.service.metadata.provider.SemanticScholarMetadataProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class MetadataProviderArchitectureTest {

    private ObjectMapper objectMapper;
    private CrossRefMetadataProvider crossRefProvider;
    private SemanticScholarMetadataProvider semanticScholarProvider;
    private OpenLibraryMetadataProvider openLibraryProvider;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        semanticScholarProvider = new SemanticScholarMetadataProvider(objectMapper, null);
        crossRefProvider = new CrossRefMetadataProvider(objectMapper, null, semanticScholarProvider);
        openLibraryProvider = new OpenLibraryMetadataProvider(objectMapper, null);
    }

    @Test
    void testSupportsConditions() {
        MetadataQuery doiQuery = MetadataQuery.of("10.1000/182", null);
        MetadataQuery isbnQuery = MetadataQuery.of(null, "9783496016663");
        MetadataQuery emptyQuery = MetadataQuery.of(null, null);

        assertThat(crossRefProvider.supports(doiQuery)).isTrue();
        assertThat(crossRefProvider.supports(isbnQuery)).isFalse();
        assertThat(crossRefProvider.supports(emptyQuery)).isFalse();

        assertThat(semanticScholarProvider.supports(doiQuery)).isTrue();
        assertThat(semanticScholarProvider.supports(isbnQuery)).isFalse();

        assertThat(openLibraryProvider.supports(isbnQuery)).isTrue();
        assertThat(openLibraryProvider.supports(doiQuery)).isFalse();
        assertThat(openLibraryProvider.supports(emptyQuery)).isFalse();
    }

    @Test
    void testCrossRefJsonParsing() {
        String json = """
                {
                  "message": {
                    "title": ["Quantum computing in the NISQ era and beyond"],
                    "author": [
                      {"given": "John", "family": "Preskill"}
                    ],
                    "issued": {"date-parts": [[2018, 8, 6]]},
                    "abstract": "<jats:p>Noisy Intermediate-Scale Quantum (NISQ) technology will be available in the near future.</jats:p>"
                  }
                }
                """;

        Optional<EnrichedMetadata> result = crossRefProvider.parseCrossRefJson("10.22331/q-2018-08-06-79", json);
        assertThat(result).isPresent();
        EnrichedMetadata meta = result.get();
        assertThat(meta.title()).isEqualTo("Quantum computing in the NISQ era and beyond");
        assertThat(meta.authors()).isEqualTo("John Preskill");
        assertThat(meta.publicationYear()).isEqualTo(2018);
        assertThat(meta.abstractText()).isEqualTo("Noisy Intermediate-Scale Quantum (NISQ) technology will be available in the near future.");
        assertThat(meta.source()).isEqualTo("CROSSREF");
    }

    @Test
    void testSemanticScholarJsonParsing() {
        String json = """
                {
                  "title": "Deep Residual Learning for Image Recognition",
                  "authors": [
                    {"name": "Kaiming He"},
                    {"name": "Xiangyu Zhang"}
                  ],
                  "year": 2016,
                  "abstract": "Deeper neural networks are more difficult to train."
                }
                """;

        Optional<EnrichedMetadata> result = semanticScholarProvider.parseSemanticScholarJson("10.1109/CVPR.2016.90", json);
        assertThat(result).isPresent();
        EnrichedMetadata meta = result.get();
        assertThat(meta.title()).isEqualTo("Deep Residual Learning for Image Recognition");
        assertThat(meta.authors()).isEqualTo("Kaiming He, Xiangyu Zhang");
        assertThat(meta.publicationYear()).isEqualTo(2016);
        assertThat(meta.abstractText()).isEqualTo("Deeper neural networks are more difficult to train.");
        assertThat(meta.source()).isEqualTo("SEMANTIC_SCHOLAR");
    }

    @Test
    void testOpenLibraryJsonParsing() {
        String json = """
                {
                  "ISBN:9780132350884": {
                    "title": "Clean Code",
                    "subtitle": "A Handbook of Agile Software Craftsmanship",
                    "authors": [
                      {"name": "Robert C. Martin"}
                    ],
                    "publish_date": "August 1, 2008",
                    "notes": "Even bad code can function. But if code isn't clean, it can bring a development organization to its knees."
                  }
                }
                """;

        Optional<EnrichedMetadata> result = openLibraryProvider.parseOpenLibraryJson("9780132350884", json);
        assertThat(result).isPresent();
        EnrichedMetadata meta = result.get();
        assertThat(meta.title()).isEqualTo("Clean Code — A Handbook of Agile Software Craftsmanship");
        assertThat(meta.authors()).isEqualTo("Robert C. Martin");
        assertThat(meta.publicationYear()).isEqualTo(2008);
        assertThat(meta.abstractText()).contains("Even bad code can function");
        assertThat(meta.source()).isEqualTo("OPENLIBRARY");
    }

    @Test
    void testCustomMetadataProviderPluggabilityInEnrichmentService() {
        MetadataProvider customProvider = new MetadataProvider() {
            @Override
            public String getName() {
                return "CUSTOM_TEST_CATALOG";
            }

            @Override
            public int getOrder() {
                return 5;
            }

            @Override
            public boolean supports(MetadataQuery query) {
                return query.hasDoi() && query.doi().startsWith("10.custom/");
            }

            @Override
            public Optional<EnrichedMetadata> lookup(MetadataQuery query) {
                return Optional.of(new EnrichedMetadata(
                        query.doi(),
                        null,
                        "Title from Custom Catalog",
                        "Dr. Custom",
                        2024,
                        "Abstract from custom catalog",
                        "CUSTOM_TEST_CATALOG"
                ));
            }
        };

        com.pdforever.config.LibraryProperties props = new com.pdforever.config.LibraryProperties(
                null, null, null, 0, false, List.of(), List.of(), null
        );
        MetadataEnrichmentService enrichmentService = new MetadataEnrichmentService(
                objectMapper,
                new FileNameCleaner(props),
                List.of(customProvider)
        );

        Document doc = new Document();
        doc.setDoi("10.custom/12345");

        boolean enriched = enrichmentService.enrichDocument(doc, null, null, false, true);

        assertThat(enriched).isTrue();
        assertThat(doc.getMetaTitle()).isEqualTo("Title from Custom Catalog");
        assertThat(doc.getAuthors()).isEqualTo("Dr. Custom");
        assertThat(doc.getPublicationYear()).isEqualTo(2024);
        assertThat(doc.getMetadataSource()).isEqualTo("CUSTOM_TEST_CATALOG");
    }
}
