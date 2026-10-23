import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  ScrollText,
  BookmarkPlus,
  Loader2,
  PanelRightOpen,
  PanelRightClose,
} from 'lucide-react';
import { BoundingBox, DocumentItem, ReadingNote } from '../types';
import { api } from '../api';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PdfViewerProps {
  document: DocumentItem;
  notes: ReadingNote[];
  targetJump: { page: number; noteId?: string; timestamp: number } | null;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onRequestCreateNote: (selection: {
    pageNumber: number;
    selectedText: string;
    boundingBox: BoundingBox;
  }) => void;
  onSelectNote: (note: ReadingNote) => void;
}

interface FloatingSelectionMenu {
  pageNumber: number;
  selectedText: string;
  boundingBox: BoundingBox;
  screenX: number;
  screenY: number;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  document: docItem,
  notes,
  targetJump,
  inspectorOpen,
  onToggleInspector,
  onRequestCreateNote,
  onSelectNote,
}) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [defaultPageSize, setDefaultPageSize] = useState<{ width: number; height: number }>({
    width: 612,
    height: 792,
  });
  const [numPages, setNumPages] = useState<number>(docItem.pageCount || 0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');
  const [scale, setScale] = useState<number>(1.25);
  const [viewMode, setViewMode] = useState<'continuous' | 'single'>('continuous');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [floatingMenu, setFloatingMenu] = useState<FloatingSelectionMenu | null>(null);
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Load PDF using HTTP Byte-Range streaming (1 MB chunks)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setFloatingMenu(null);

    const streamUrl = api.getStreamUrl(docItem.id);
    const loadingTask = pdfjsLib.getDocument({
      url: streamUrl,
      rangeChunkSize: 1024 * 1024, // 1 MB chunk size for 206 Partial Content streaming
      disableAutoFetch: true,
      disableStream: false,
    });

    loadingTask.promise
      .then(async (loadedPdf) => {
        if (cancelled) {
          loadedPdf.destroy();
          return;
        }
        try {
          const firstPage = await loadedPdf.getPage(1);
          const unscaledViewport = firstPage.getViewport({ scale: 1 });
          if (!cancelled) {
            setDefaultPageSize({
              width: unscaledViewport.width,
              height: unscaledViewport.height,
            });
          }
        } catch {
          // Fallback to standard dimensions if page 1 metadata fails
        }
        if (cancelled) {
          loadedPdf.destroy();
          return;
        }
        setPdfDoc(loadedPdf);
        setNumPages(loadedPdf.numPages);
        setCurrentPage(1);
        setPageInput('1');
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to stream PDF document.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [docItem.id]);

  // Handle jump to page / highlight from search or notes sidebar
  useEffect(() => {
    if (!targetJump || !pdfDoc) return;
    const targetPage = Math.max(1, Math.min(numPages || 1, targetJump.page));
    setCurrentPage(targetPage);
    setPageInput(String(targetPage));

    if (targetJump.noteId) {
      setHighlightedNoteId(targetJump.noteId);
      const timer = setTimeout(() => setHighlightedNoteId(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [targetJump, pdfDoc, numPages]);

  useEffect(() => {
    if (!targetJump || !pdfDoc) return;
    const targetPage = Math.max(1, Math.min(numPages || 1, targetJump.page));
    const scrollToTarget = () => {
      const pageEl = pageRefs.current.get(targetPage);
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    };
    const rafId = requestAnimationFrame(() => {
      scrollToTarget();
      // Re-verify position after target page layout settles
      setTimeout(scrollToTarget, 80);
    });
    return () => cancelAnimationFrame(rafId);
  }, [targetJump, pdfDoc, numPages, viewMode]);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(numPages || 1, page));
      setCurrentPage(clamped);
      setPageInput(String(clamped));
      if (viewMode === 'continuous') {
        const el = pageRefs.current.get(clamped);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    },
    [numPages, viewMode]
  );

  // Detect text selection inside a page's TextLayer and normalize coordinates to 0.0 - 1.0
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setFloatingMenu(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setFloatingMenu(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const anchorEl =
      range.commonAncestorContainer instanceof HTMLElement
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;

    const pageContainer = anchorEl?.closest('[data-page-number]') as HTMLElement | null;
    if (!pageContainer) {
      setFloatingMenu(null);
      return;
    }

    const pageNumber = Number(pageContainer.dataset.pageNumber);
    const pageRect = pageContainer.getBoundingClientRect();
    const selRect = range.getBoundingClientRect();

    if (pageRect.width <= 0 || pageRect.height <= 0) {
      return;
    }

    const clamp01 = (v: number) => Math.max(0, Math.min(1, Number(v.toFixed(4))));
    const boundingBox: BoundingBox = {
      x1: clamp01((selRect.left - pageRect.left) / pageRect.width),
      y1: clamp01((selRect.top - pageRect.top) / pageRect.height),
      x2: clamp01((selRect.right - pageRect.left) / pageRect.width),
      y2: clamp01((selRect.bottom - pageRect.top) / pageRect.height),
    };

    setFloatingMenu({
      pageNumber,
      selectedText: text,
      boundingBox,
      screenX: selRect.left + selRect.width / 2,
      screenY: Math.max(60, selRect.top - 10),
    });
  }, []);

  // Track current visible page on continuous scroll
  const handleScroll = useCallback(() => {
    if (viewMode !== 'continuous' || !scrollContainerRef.current) return;
    const containerRect = scrollContainerRef.current.getBoundingClientRect();
    const centerLine = containerRect.top + containerRect.height * 0.35;

    for (const [pageNum, el] of pageRefs.current.entries()) {
      const rect = el.getBoundingClientRect();
      if (rect.top <= centerLine && rect.bottom >= centerLine) {
        if (currentPage !== pageNum) {
          setCurrentPage(pageNum);
          setPageInput(String(pageNum));
        }
        break;
      }
    }
  }, [viewMode, currentPage]);

  const pagesToRender =
    viewMode === 'single'
      ? [currentPage]
      : Array.from({ length: numPages }, (_, idx) => idx + 1);

  return (
    <div className="flex flex-col h-full w-full bg-slate-100 dark:bg-slate-950 select-text">
      {/* Reader Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-xs z-20">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate max-w-xs sm:max-w-md"
            title={docItem.relativePath}
          >
            {docItem.fileName}
          </span>
          <span className="hidden md:inline-block text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
            {(docItem.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
          </span>
        </div>

        {/* Page Navigation & Zoom Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
            title="Previous Page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = parseInt(pageInput, 10);
              if (!Number.isNaN(parsed)) goToPage(parsed);
            }}
            className="flex items-center gap-1 text-xs"
          >
            <input
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              className="w-12 text-center rounded border border-slate-300 dark:border-slate-700 bg-transparent py-1 text-xs font-medium"
            />
            <span className="text-slate-500 dark:text-slate-400">/ {numPages}</span>
          </form>

          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= numPages}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
            title="Next Page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

          <button
            onClick={() => setScale((s) => Math.max(0.6, Number((s - 0.15).toFixed(2))))}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono w-12 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(2.5, Number((s + 0.15).toFixed(2))))}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

          <button
            onClick={() => setViewMode((m) => (m === 'continuous' ? 'single' : 'continuous'))}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
            title="Toggle Continuous Scroll vs Single Page"
          >
            {viewMode === 'continuous' ? (
              <>
                <ScrollText className="w-3.5 h-3.5 text-blue-500" />
                <span className="hidden sm:inline">Continuous</span>
              </>
            ) : (
              <>
                <BookOpen className="w-3.5 h-3.5 text-amber-500" />
                <span className="hidden sm:inline">Single Page</span>
              </>
            )}
          </button>

          <button
            onClick={onToggleInspector}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            title="Toggle Document Notes & Tags Inspector"
          >
            {inspectorOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Floating Selection Context Menu: Add Reading Note */}
      {floatingMenu && (
        <div
          style={{
            position: 'fixed',
            left: `${floatingMenu.screenX}px`,
            top: `${floatingMenu.screenY}px`,
            transform: 'translate(-50%, -100%)',
          }}
          className="z-50 animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRequestCreateNote({
                pageNumber: floatingMenu.pageNumber,
                selectedText: floatingMenu.selectedText,
                boundingBox: floatingMenu.boundingBox,
              });
              window.getSelection()?.removeAllRanges();
              setFloatingMenu(null);
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-semibold text-xs shadow-xl ring-2 ring-white/20 hover:scale-105 transition"
          >
            <BookmarkPlus className="w-4 h-4" />
            Add Reading Note
          </button>
        </div>
      )}

      {/* Main Scrollable PDF Viewport */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onMouseUp={handleMouseUp}
        className="flex-1 overflow-auto p-4 sm:p-6 flex flex-col items-center gap-6"
      >
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className="text-sm">Streaming PDF via HTTP 206 Byte-Ranges…</p>
          </div>
        )}

        {error && (
          <div className="max-w-md rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-5 text-center">
            <p className="font-semibold text-red-700 dark:text-red-300 mb-1">Unable to load PDF</p>
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {pdfDoc &&
          pagesToRender.map((pageNumber) => {
            const pageNotes = notes.filter((n) => n.pageNumber === pageNumber);
            return (
              <PdfPageSurface
                key={pageNumber}
                pdfDoc={pdfDoc}
                pageNumber={pageNumber}
                scale={scale}
                defaultPageSize={defaultPageSize}
                pageNotes={pageNotes}
                highlightedNoteId={highlightedNoteId}
                onSelectNote={onSelectNote}
                registerPageEl={(el) => {
                  if (el) pageRefs.current.set(pageNumber, el);
                  else pageRefs.current.delete(pageNumber);
                }}
              />
            );
          })}
      </div>
    </div>
  );
};

interface PdfPageSurfaceProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  defaultPageSize: { width: number; height: number };
  pageNotes: ReadingNote[];
  highlightedNoteId: string | null;
  onSelectNote: (note: ReadingNote) => void;
  registerPageEl: (el: HTMLDivElement | null) => void;
}

const PdfPageSurface: React.FC<PdfPageSurfaceProps> = ({
  pdfDoc,
  pageNumber,
  scale,
  defaultPageSize,
  pageNotes,
  highlightedNoteId,
  onSelectNote,
  registerPageEl,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(pageNumber <= 3);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: Math.floor(defaultPageSize.width * scale),
    height: Math.floor(defaultPageSize.height * scale),
  });

  useEffect(() => {
    if (!isVisible) {
      setDimensions({
        width: Math.floor(defaultPageSize.width * scale),
        height: Math.floor(defaultPageSize.height * scale),
      });
    }
  }, [defaultPageSize, scale, isVisible]);

  // Lazy-render pages via IntersectionObserver so 500+ page books stay fast & low-memory
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
          }
        }
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    let textLayerInstance: pdfjsLib.TextLayer | null = null;

    pdfDoc
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        setDimensions({
          width: Math.floor(viewport.width),
          height: Math.floor(viewport.height),
        });

        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;
        if (!canvas || !textLayerDiv) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        renderTask = page.render({
          canvasContext: ctx,
          viewport,
        });
        await renderTask.promise;

        if (cancelled) return;

        // Render selectable PDF.js TextLayer
        textLayerDiv.innerHTML = '';
        textLayerDiv.style.setProperty('--scale-factor', String(viewport.scale));
        textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
        textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;

        const textContent = await page.getTextContent();
        if (cancelled) return;

        textLayerInstance = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayerInstance.render();
      })
      .catch(() => {
        // Ignore cancelled render task errors
      });

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
      if (textLayerInstance) {
        textLayerInstance.cancel();
      }
    };
  }, [pdfDoc, pageNumber, scale, isVisible]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        registerPageEl(el);
      }}
      data-page-number={pageNumber}
      style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px` }}
      className="pdf-page-container relative bg-white shadow-lg ring-1 ring-slate-300 dark:ring-slate-800 rounded-xs shrink-0"
    >
      <canvas ref={canvasRef} className="block pointer-events-none" />

      {/* Visual Highlight Overlays for ReadingNotes (Normalized 0.0 - 1.0 coordinates) */}
      <div className="absolute inset-0 pointer-events-none z-20">
        {pageNotes.map((note) => {
          const { x1, y1, x2, y2 } = note.boundingBox;
          const left = `${Math.max(0, Math.min(98, x1 * 100))}%`;
          const top = `${Math.max(0, Math.min(98, y1 * 100))}%`;
          const width = `${Math.max(3, Math.min(100 - x1 * 100, (x2 - x1) * 100))}%`;
          const height = `${Math.max(1.8, Math.min(100 - y1 * 100, (y2 - y1) * 100))}%`;
          const isPulse = highlightedNoteId === note.id;

          return (
            <div
              key={note.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectNote(note);
              }}
              style={{ left, top, width, height }}
              title={`${note.noteMarkdown}\n(Click to view note)`}
              className={`pointer-events-auto absolute cursor-pointer rounded-xs transition-all duration-300 ${
                isPulse
                  ? 'bg-amber-400/60 ring-4 ring-amber-500 shadow-lg scale-[1.02]'
                  : 'bg-amber-300/35 hover:bg-amber-400/50 border-b-2 border-amber-500/80'
              }`}
            />
          );
        })}
      </div>

      {/* Selectable PDF.js TextLayer */}
      <div ref={textLayerRef} className="textLayer" />

      {/* Subtle Page Number Footer Badge */}
      <div className="absolute bottom-2 right-3 z-30 pointer-events-none px-2 py-0.5 rounded bg-slate-900/65 text-[11px] font-mono text-white">
        p. {pageNumber}
      </div>
    </div>
  );
};

