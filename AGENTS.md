# AGENTS.md — AI Coding Agent Guidelines for PDForever

## 1. Project Overview
**PDForever** is a self-hosted, in-place PDF Document Management and Excerpting System (*Lesezettel*) built for personal libraries of 1,000+ PDFs (books, magazines, academic papers).

### Core Principle: Strict In-Place Storage
- PDFs reside in `library.root-dir` (default: `./storage`).
- **Never move, rename, or modify PDF files on disk.**
- Display names are cleaned non-destructively at ingestion time via `FileNameCleaner` (configured via `library.clean-remove-literals` and `library.clean-remove-regexes` in `application.yml`).
- All database and Lucene references store **portable relative paths** using forward slashes (`/`), even on Windows.

---

## 2. Tech Stack

### Backend (`/src/main/java/com/pdforever`)
- **Language & Runtime**: Java 21 (Virtual Threads enabled: `spring.threads.virtual.enabled=true`)
- **Framework**: Spring Boot 3.3.5 (`spring-boot-starter-web`, `spring-boot-starter-data-jpa`, `spring-boot-starter-validation`)
- **Database**: SQLite (`org.xerial:sqlite-jdbc` + `org.hibernate.community.dialect.SQLiteDialect`) in `WAL` mode (`./data/pdforever.db`)
- **PDF Processing**: Apache PDFBox 3.0.3 (`Loader.loadPDF`, `PDFTextStripper`, `PDFRenderer`)
- **Fulltext Search**: Embedded Apache Lucene 9.11.1 (`StandardAnalyzer`, `BM25Similarity`, `UnifiedHighlighter`) in `./data/lucene-index`

### Frontend (`/frontend`)
- **Framework**: React 18 + TypeScript 5 + Vite 5
- **Styling**: Tailwind CSS 3 (dark mode via `.dark` class on `<html>`)
- **Icons**: `lucide-react`
- **PDF Rendering**: `pdfjs-dist` (Mozilla PDF.js v4) with HTTP 206 Byte-Range chunked streaming and selectable `TextLayer`

---

## 3. Repository Structure

```text
pdforever/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── DocumentCover.tsx   # Lazy-loaded cover thumbnail (Backend JPEG + PDF.js fallback)
│   │   │   ├── NoteModal.tsx       # Create/edit ReadingNote (Lesezettel) modal
│   │   │   ├── PdfViewer.tsx       # Continuous & single-page PDF.js viewer + text selection hook
│   │   │   └── SettingsModal.tsx   # User settings dialog (Cover toggle/layout, theme, reader defaults)
│   │   ├── App.tsx                 # Main 3-panel workspace (Sidebar, Document Explorer / Reader, Inspector)
│   │   ├── api.ts                  # Typed REST client for /api/*
│   │   └── types.ts                # Shared TypeScript interfaces (DocumentItem, ReadingNote, AppSettings, etc.)
│   ├── package.json
│   └── vite.config.ts              # Proxies /api to localhost:8080; builds into ../src/main/resources/static
├── src/
│   ├── main/
│   │   ├── java/com/pdforever/
│   │   │   ├── config/             # LibraryProperties (@ConfigurationProperties("library")), WebConfig
│   │   │   ├── controller/         # DocumentController, SearchController, NoteAndTagController
│   │   │   ├── domain/             # JPA Entities: Document, Tag, ReadingNote
│   │   │   ├── dto/                # Java records for REST requests/responses
│   │   │   ├── repository/         # Spring Data JPA repositories
│   │   │   └── service/            # DirectoryScannerService, FileWatcherService, PdfExtractionService,
│   │   │                           # LuceneIndexService, SearchService, LibraryManagementService, FileNameCleaner
│   │   └── resources/
│   │       └── application.yml     # App, SQLite, and library.* configuration
│   └── test/
│       └── java/com/pdforever/
│           └── IngestionAndSearchIntegrationTest.java
├── data/                           # Git-ignored runtime data (pdforever.db, lucene-index/, covers/)
└── storage/                        # Git-ignored in-place PDF library root
```

---

## 4. Build, Run & Verification Commands

### Frontend
Run from the `frontend/` directory:
- **Typecheck & Production Build** (outputs to `src/main/resources/static/`, which is git-ignored):
  ```bash
  cd frontend
  npm run build
  ```
- **Dev Server with Hot Reload** (`http://localhost:5173`, proxies `/api` to `http://localhost:8080`):
  ```bash
  cd frontend
  npm run dev
  ```

### Backend
Run from the repository root:
- **Start Backend Server** (`http://localhost:8080`):
  ```bash
  mvn spring-boot:run
  ```
- **Run Integration Tests**:
  ```bash
  mvn test
  ```
  *(Note: In restricted/sandboxed environments without internet access, avoid invoking `./mvnw.cmd` if the Maven wrapper distribution is not cached locally; prefer a local `mvn` installation or offline flag `-o`.)*

---

## 5. Architectural Invariants & Coding Guidelines

### Backend Rules
1. **Path Security & Normalization**:
   - Always resolve document paths against `scannerService.getRootPath()` (or `getCoversPath()`), call `.normalize()`, and verify `.startsWith(rootPath)` before reading or streaming files.
   - Convert Windows backslashes (`\`) to `/` before persisting `relativePath` in SQLite or Lucene.
2. **SQLite Single-Writer Safety**:
   - Keep `spring.datasource.hikari.maximum-pool-size: 1` with `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`. Do not increase pool size, as concurrent writes in SQLite will trigger `SQLITE_BUSY` exceptions.
3. **Apache PDFBox 3.x Conventions**:
   - Always use `Loader.loadPDF(new RandomAccessReadBufferedFile(path))` inside a `try-with-resources` block. Do **not** use PDFBox 2.x `PDDocument.load(...)`.
   - Handle corrupt or unreadable PDFs gracefully in `PdfExtractionService` without crashing the directory scan or watcher loop.
4. **Cover Thumbnail Cache (`./data/covers`)**:
   - `GET /api/documents/{id}/cover` renders page 1 (`pageIndex = 0`) as a JPEG (`MAX_COVER_WIDTH = 420`, `120 DPI`) and caches it under `library.covers-dir` (`./data/covers/{id}.jpg`).
   - Whenever a PDF is re-indexed or marked deleted in `DirectoryScannerService`, ensure `deleteCachedCover(doc.getId())` is called so stale covers are never served.
5. **Lucene Page-Level Index**:
   - Each PDF page is indexed as a separate Lucene document containing `docId` (`StringField`), `pageKey` (`StringField`), `relPath` (`StoredField`), `pageNumber` (`IntPoint` + `StoredField`), and `content` (`Field` with `IndexOptions.DOCS_AND_FREQS_AND_POSITIONS_AND_OFFSETS` and stored term vectors for fast `UnifiedHighlighter` snippets).
   - When re-indexing or deleting a document, always purge existing page documents by `new Term("docId", docId.toString())`.

### Frontend Rules
1. **Build Artifacts**:
   - `src/main/resources/static/` and `frontend/tsconfig.tsbuildinfo` are generated artifacts and must remain in `.gitignore`.
   - Always run `npm run build` in `frontend/` after making TypeScript/React changes to verify strict `tsc -b` compilation and update the static bundle served by Spring Boot.
2. **Normalized Coordinates for Reading Notes (`Lesezettel`)**:
   - Highlight bounding boxes (`BoundingBox: { x1, y1, x2, y2 }`) are stored normalized in the range `0.0` to `1.0` relative to the page's width and height so overlays scale accurately at any zoom level.
3. **User Settings (`AppSettings`)**:
   - Persisted in `localStorage` under `pdforever.settings` (and theme under `pdforever.darkMode`).
   - New user-configurable UI options should be added to `AppSettings` in `frontend/src/types.ts` with sensible defaults in `DEFAULT_SETTINGS` (`frontend/src/App.tsx`) and exposed in `frontend/src/components/SettingsModal.tsx`.

