import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  BookOpen,
  ScrollText,
  BookmarkPlus,
  Loader2,
  PanelRightOpen,
  PanelRightClose,
  Columns2,
  BookOpenCheck,
  CheckCircle2,
  Clock,
  CircleDashed,
  X,
  FileText,
} from 'lucide-react';
import {
  BoundingBox,
  DocumentItem,
  ReaderViewMode,
  ReadingNote,
  ReadingStatus,
  TocItem,
  UpdateReadingProgressPayload,
} from '../types';
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
  defaultViewMode?: ReaderViewMode;
  isSplitView?: boolean;
  isSecondaryPane?: boolean;
  availableDocuments?: DocumentItem[];
  onToggleInspector?: () => void;
  onToggleSplitView?: () => void;
  onCloseSecondaryPane?: () => void;
  onChangeSecondaryDocument?: (docId: string) => void;
  onUpdateProgress?: (docId: string, payload: UpdateReadingProgressPayload) => void;
  onPageChange?: (page: number) => void;
  onRequestCreateNote: (selection: {
    documentId: string;
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

export function countTocItems(items: TocItem[]): number {
  return items.reduce((acc, item) => acc + 1 + countTocItems(item.children || []), 0);
}

export function findActiveTocPage(items: TocItem[], currentPage: number): number | null {
  let bestPage: number | null = null;
  const traverse = (nodes: TocItem[]) => {
    for (const node of nodes) {
      if (node.pageNumber !== null && node.pageNumber <= currentPage) {
        if (bestPage === null || node.pageNumber >= bestPage) {
          bestPage = node.pageNumber;
        }
      }
      if (node.children?.length) {
        traverse(node.children);
      }
    }
  };
  traverse(items);
  return bestPage;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  document: docItem,
  notes,
  targetJump,
  inspectorOpen,
  defaultViewMode = 'continuous',
  isSplitView = false,
  isSecondaryPane = false,
  availableDocuments = [],
  onToggleInspector,
  onToggleSplitView,
  onCloseSecondaryPane,
  onChangeSecondaryDocument,
  onUpdateProgress,
  onPageChange,
  onRequestCreateNote,
  onSelectNote,
}) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [defaultPageSize, setDefaultPageSize] = useState<{ width: number; height: number }>({
    width: 612,
    height: 792,
  });
  const [baseScale, setBaseScale] = useState<number>(1.0);
  const [spreadBaseScale, setSpreadBaseScale] = useState<number>(0.75);
  const [numPages, setNumPages] = useState<number>(docItem.pageCount || 1);
  const initialPage = Math.max(
    1,
    Math.min(docItem.pageCount || 1, targetJump?.page || docItem.lastReadPage || 1)
  );
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [pageInput, setPageInput] = useState<string>(String(initialPage));
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const zoomByDocRef = useRef<Map<string, number>>(new Map());
  const [viewMode, setViewMode] = useState<ReaderViewMode>(defaultViewMode);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [floatingMenu, setFloatingMenu] = useState<FloatingSelectionMenu | null>(null);
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const initialScrollDoneRef = useRef<boolean>(false);
  const lastReportedPageRef = useRef<number>(initialPage);

  useEffect(() => {
    setViewMode(defaultViewMode);
  }, [defaultViewMode]);

  useEffect(() => {
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);

  const recomputeScales = useCallback(
    (unscaledWidth: number) => {
      if (unscaledWidth <= 0) return;
      const containerWidth = scrollContainerRef.current?.clientWidth || (isSplitView ? 620 : 960);
      const singleTargetPx = Math.max(360, Math.min(920, containerWidth - 56));
      const twoPageTargetPx = Math.max(520, containerWidth - 64);

      setBaseScale(singleTargetPx / unscaledWidth);
      setSpreadBaseScale(twoPageTargetPx / (unscaledWidth * 2 + 16));
    },
    [isSplitView]
  );

  // Recompute base scale when split view, inspector, or container width changes
  useEffect(() => {
    const timer = setTimeout(() => {
      recomputeScales(defaultPageSize.width);
    }, 60);
    return () => clearTimeout(timer);
  }, [isSplitView, inspectorOpen, defaultPageSize.width, recomputeScales]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        recomputeScales(defaultPageSize.width);
      }, 60);
    });
    observer.observe(el);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [defaultPageSize.width, recomputeScales]);

  const updateDocZoom = useCallback(
    (updater: (prev: number) => number) => {
      setZoomLevel((prev) => {
        const next = Math.max(0.4, Math.min(3.0, Number(updater(prev).toFixed(2))));
        zoomByDocRef.current.set(docItem.id, next);
        return next;
      });
    },
    [docItem.id]
  );

  // Load PDF using HTTP Byte-Range streaming (1 MB chunks)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setFloatingMenu(null);
    initialScrollDoneRef.current = false;

    const savedDocZoom = zoomByDocRef.current.get(docItem.id) ?? 1.0;
    setZoomLevel(savedDocZoom);

    const startPage = Math.max(
      1,
      Math.min(docItem.pageCount || 1, targetJump?.page || docItem.lastReadPage || 1)
    );
    setCurrentPage(startPage);
    setPageInput(String(startPage));
    lastReportedPageRef.current = startPage;

    const streamUrl = api.getStreamUrl(docItem.id);
    const loadingTask = pdfjsLib.getDocument({
      url: streamUrl,
      rangeChunkSize: 1024 * 1024,
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
          if (!cancelled && unscaledViewport.width > 0) {
            setDefaultPageSize({
              width: unscaledViewport.width,
              height: unscaledViewport.height,
            });
            recomputeScales(unscaledViewport.width);
          }
        } catch {
          // Fallback to standard dimensions if page 1 metadata fails
        }
        if (cancelled) {
          loadedPdf.destroy();
          return;
        }
        const clampedStart = Math.max(1, Math.min(loadedPdf.numPages || 1, startPage));
        setPdfDoc(loadedPdf);
        setNumPages(loadedPdf.numPages);
        setCurrentPage(clampedStart);
        setPageInput(String(clampedStart));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docItem.id]);

  // Scroll to restored lastReadPage on initial load in continuous mode
  useEffect(() => {
    if (!pdfDoc || loading || initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;
    if (viewMode === 'continuous' && currentPage > 1) {
      const scrollToSaved = () => {
        const el = pageRefs.current.get(currentPage);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
      };
      requestAnimationFrame(() => {
        scrollToSaved();
        setTimeout(scrollToSaved, 90);
      });
    }
  }, [pdfDoc, loading, viewMode, currentPage]);

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
      setTimeout(scrollToTarget, 80);
    });
    return () => cancelAnimationFrame(rafId);
  }, [targetJump, pdfDoc, numPages, viewMode]);

  // Debounced Reading Progress Persistence
  useEffect(() => {
    if (!pdfDoc || loading || !onUpdateProgress) return;
    if (currentPage === lastReportedPageRef.current && docItem.lastOpenedAt) return;

    const timer = setTimeout(() => {
      lastReportedPageRef.current = currentPage;
      onUpdateProgress(docItem.id, { lastReadPage: currentPage });
    }, 500);

    return () => clearTimeout(timer);
  }, [currentPage, pdfDoc, loading, docItem.id, docItem.lastOpenedAt, onUpdateProgress]);

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
      } else if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [numPages, viewMode]
  );

  // Compute pages to render based on viewMode ('continuous' | 'single' | 'spread' | 'book')
  const { pagesToRender, isTwoPageLayout } = useMemo(() => {
    if (viewMode === 'continuous') {
      return {
        pagesToRender: Array.from({ length: numPages }, (_, idx) => idx + 1),
        isTwoPageLayout: false,
      };
    }
    if (viewMode === 'single') {
      return {
        pagesToRender: [currentPage],
        isTwoPageLayout: false,
      };
    }
    if (viewMode === 'spread') {
      // Paired pages: [1, 2], [3, 4], [5, 6]...
      const startPage = currentPage % 2 === 1 ? currentPage : Math.max(1, currentPage - 1);
      const pair = [startPage];
      if (startPage + 1 <= numPages) {
        pair.push(startPage + 1);
      }
      return {
        pagesToRender: pair,
        isTwoPageLayout: pair.length > 1,
      };
    }
    // 'book' mode: Page 1 is cover (solo), then [2, 3], [4, 5], [6, 7]...
    if (currentPage <= 1) {
      return {
        pagesToRender: [1],
        isTwoPageLayout: false,
      };
    }
    const evenStart = currentPage % 2 === 0 ? currentPage : currentPage - 1;
    const bookPair = [evenStart];
    if (evenStart + 1 <= numPages) {
      bookPair.push(evenStart + 1);
    }
    return {
      pagesToRender: bookPair,
      isTwoPageLayout: bookPair.length > 1,
    };
  }, [viewMode, currentPage, numPages]);

  const handlePrevPage = useCallback(() => {
    if (viewMode === 'spread') {
      const startPage = currentPage % 2 === 1 ? currentPage : Math.max(1, currentPage - 1);
      goToPage(startPage - 2);
    } else if (viewMode === 'book') {
      if (currentPage <= 1) return;
      if (currentPage <= 3) {
        goToPage(1);
      } else {
        const evenStart = currentPage % 2 === 0 ? currentPage : currentPage - 1;
        goToPage(evenStart - 2);
      }
    } else {
      goToPage(currentPage - 1);
    }
  }, [viewMode, currentPage, goToPage]);

  const handleNextPage = useCallback(() => {
    if (viewMode === 'spread') {
      const startPage = currentPage % 2 === 1 ? currentPage : Math.max(1, currentPage - 1);
      goToPage(startPage + 2);
    } else if (viewMode === 'book') {
      if (currentPage <= 1) {
        goToPage(2);
      } else {
        const evenStart = currentPage % 2 === 0 ? currentPage : currentPage - 1;
        goToPage(evenStart + 2);
      }
    } else {
      goToPage(currentPage + 1);
    }
  }, [viewMode, currentPage, goToPage]);

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

  const effectiveScale = (isTwoPageLayout ? spreadBaseScale : baseScale) * zoomLevel;
  const readingPercent = Math.min(100, Math.max(0, Math.round((currentPage / Math.max(1, numPages)) * 100)));
  const currentStatus: ReadingStatus = docItem.readingStatus || 'UNREAD';

  const cycleReadingStatus = () => {
    if (!onUpdateProgress) return;
    const nextStatus: ReadingStatus =
      currentStatus === 'UNREAD'
        ? 'READING'
        : currentStatus === 'READING'
        ? 'COMPLETED'
        : 'UNREAD';
    onUpdateProgress(docItem.id, {
      readingStatus: nextStatus,
      lastReadPage: nextStatus === 'UNREAD' ? 1 : currentPage,
    });
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-100 dark:bg-slate-950 select-text relative">
      {/* Reader Toolbar */}
      <div className="flex flex-col bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-xs z-20">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          {/* Left Group: Document Title / Switcher & Reading Status */}
          <div className="flex items-center gap-2 min-w-0">
            {/* Secondary Split-Pane Document Selector OR Primary Title */}
            {isSecondaryPane && onChangeSecondaryDocument && availableDocuments.length > 0 ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <FileText className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <select
                  value={docItem.id}
                  onChange={(e) => onChangeSecondaryDocument(e.target.value)}
                  className="max-w-[200px] sm:max-w-xs truncate rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  title="Dokument im Split-View wechseln"
                >
                  {availableDocuments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fileName} ({d.pageCount} S.)
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <span
                className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate max-w-[160px] sm:max-w-xs"
                title={docItem.relativePath}
              >
                {docItem.fileName}
              </span>
            )}

            {/* Reading Status Badge (Click to cycle: Ungelesen -> Am Lesen -> Gelesen) */}
            {onUpdateProgress && (
              <button
                onClick={cycleReadingStatus}
                className={`hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition ${
                  currentStatus === 'COMPLETED'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : currentStatus === 'READING'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                    : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                }`}
                title="Lesestatus ändern (Klicken zum Wechseln: Ungelesen → Am Lesen → Gelesen)"
              >
                {currentStatus === 'COMPLETED' ? (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Gelesen</span>
                  </>
                ) : currentStatus === 'READING' ? (
                  <>
                    <Clock className="w-3 h-3" />
                    <span>Am Lesen ({readingPercent}%)</span>
                  </>
                ) : (
                  <>
                    <CircleDashed className="w-3 h-3" />
                    <span>Ungelesen</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Right Group: Page Navigation, Zoom, View Modes (Continuous, Single, Spread, Book), Split-View */}
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={handlePrevPage}
              disabled={currentPage <= 1}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
              title="Vorherige Seite"
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
                className="w-11 text-center rounded border border-slate-300 dark:border-slate-700 bg-transparent py-1 text-xs font-medium"
              />
              <span className="text-slate-500 dark:text-slate-400 font-mono">
                {pagesToRender.length === 2
                  ? `–${pagesToRender[1]} / ${numPages}`
                  : `/ ${numPages}`}
              </span>
            </form>

            <button
              onClick={handleNextPage}
              disabled={pagesToRender[pagesToRender.length - 1] >= numPages}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
              title="Nächste Seite"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-0.5" />

            <button
              onClick={() => updateDocZoom((z) => z - 0.15)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Verkleinern"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => updateDocZoom(() => 1.0)}
              className="text-xs font-mono w-11 text-center py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Zoom auf 100% zurücksetzen"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              onClick={() => updateDocZoom((z) => z + 0.15)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Vergrößern"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-0.5" />

            {/* View Mode Selector: Continuous | Single | Spread (2-Page) | Book (Cover + 2-Page) */}
            <div className="inline-flex items-center rounded-lg p-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70">
              <button
                type="button"
                onClick={() => setViewMode('continuous')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition ${
                  viewMode === 'continuous'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Fortlaufend scrollen"
              >
                <ScrollText className="w-3.5 h-3.5" />
                <span className="hidden 2xl:inline">Fortlaufend</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('single')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition ${
                  viewMode === 'single'
                    ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Einzelseiten-Ansicht"
              >
                <FileText className="w-3.5 h-3.5" />
                <span className="hidden 2xl:inline">Einzeln</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('spread')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition ${
                  viewMode === 'spread'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Doppelseiten-Modus (Seite 1–2, 3–4, …)"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden 2xl:inline">Doppelseite</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('book')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition ${
                  viewMode === 'book'
                    ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Buchmodus (Deckblatt einzeln, danach Doppelseiten 2–3, 4–5, …)"
              >
                <BookOpenCheck className="w-3.5 h-3.5" />
                <span className="hidden 2xl:inline">Buch</span>
              </button>
            </div>

            {/* Split-View Toggle (Primary Pane) or Close Button (Secondary Pane) */}
            {!isSecondaryPane && onToggleSplitView && (
              <button
                onClick={onToggleSplitView}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                  isSplitView
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}
                title="Split-View (Vergleichsmodus mit 2 Dokumenten oder 2 Ansichten nebeneinander)"
              >
                <Columns2 className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Split-View</span>
              </button>
            )}

            {isSecondaryPane && onCloseSecondaryPane && (
              <button
                onClick={onCloseSecondaryPane}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition"
                title="Split-View schließen"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {!isSecondaryPane && onToggleInspector && (
              <button
                onClick={onToggleInspector}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                title="Notizen & Tags Inspector ein-/ausblenden"
              >
                {inspectorOpen ? (
                  <PanelRightClose className="w-4 h-4" />
                ) : (
                  <PanelRightOpen className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Subtle Reading Progress Bar along bottom of Toolbar */}
        <div className="h-0.5 w-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              currentStatus === 'COMPLETED'
                ? 'bg-emerald-500'
                : 'bg-gradient-to-r from-blue-500 to-indigo-500'
            }`}
            style={{ width: `${readingPercent}%` }}
          />
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
                documentId: docItem.id,
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

      {/* Body Area: Scrollable PDF Viewport */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
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
            (isTwoPageLayout ? (
              /* Two-Page Spread / Book Facing Pages Container */
              <div className="flex items-start justify-center gap-1 sm:gap-2 my-auto">
                {pagesToRender.map((pageNumber, idx) => {
                  const pageNotes = notes.filter((n) => n.pageNumber === pageNumber);
                  const isLeftBookPage = viewMode === 'book' && idx === 0 && pagesToRender.length === 2;
                  const isRightBookPage = viewMode === 'book' && idx === 1 && pagesToRender.length === 2;
                  return (
                    <div
                      key={pageNumber}
                      className={`relative ${
                        isLeftBookPage
                          ? 'shadow-[inset_-12px_0_20px_-10px_rgba(0,0,0,0.35)]'
                          : isRightBookPage
                          ? 'shadow-[inset_12px_0_20px_-10px_rgba(0,0,0,0.35)]'
                          : ''
                      }`}
                    >
                      <PdfPageSurface
                        pdfDoc={pdfDoc}
                        pageNumber={pageNumber}
                        scale={effectiveScale}
                        defaultPageSize={defaultPageSize}
                        pageNotes={pageNotes}
                        highlightedNoteId={highlightedNoteId}
                        forceVisible={true}
                        onSelectNote={onSelectNote}
                        registerPageEl={(el) => {
                          if (el) pageRefs.current.set(pageNumber, el);
                          else pageRefs.current.delete(pageNumber);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              pagesToRender.map((pageNumber) => {
                const pageNotes = notes.filter((n) => n.pageNumber === pageNumber);
                return (
                  <PdfPageSurface
                    key={pageNumber}
                    pdfDoc={pdfDoc}
                    pageNumber={pageNumber}
                    scale={effectiveScale}
                    defaultPageSize={defaultPageSize}
                    pageNotes={pageNotes}
                    highlightedNoteId={highlightedNoteId}
                    forceVisible={viewMode !== 'continuous'}
                    onSelectNote={onSelectNote}
                    registerPageEl={(el) => {
                      if (el) pageRefs.current.set(pageNumber, el);
                      else pageRefs.current.delete(pageNumber);
                    }}
                  />
                );
              })
            ))}
        </div>
      </div>
    </div>
  );
};

interface TocTreeNodeProps {
  item: TocItem;
  level: number;
  filterQuery: string;
  activeTocPage: number | null;
  onSelectPage: (page: number) => void;
}

export const TocTreeNode: React.FC<TocTreeNodeProps> = ({
  item,
  level,
  filterQuery,
  activeTocPage,
  onSelectPage,
}) => {
  const [expanded, setExpanded] = useState<boolean>(level < 2);
  const hasChildren = Boolean(item.children && item.children.length > 0);

  const matchesFilter = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return true;
    const check = (node: TocItem): boolean => {
      if (node.title.toLowerCase().includes(q)) return true;
      return (node.children || []).some(check);
    };
    return check(item);
  }, [item, filterQuery]);

  if (!matchesFilter) return null;

  const isActive = item.pageNumber !== null && item.pageNumber === activeTocPage;
  const isExpanded = filterQuery.trim() ? true : expanded;

  return (
    <div>
      <div
        style={{ paddingLeft: `${level * 12 + 6}px` }}
        className={`flex items-center justify-between gap-1.5 pr-2 py-1.5 rounded-lg text-xs transition ${
          isActive
            ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-300'
        }`}
      >
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((prev) => !prev);
              }}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          <button
            type="button"
            onClick={() => item.pageNumber && onSelectPage(item.pageNumber)}
            disabled={!item.pageNumber}
            className="flex-1 text-left truncate disabled:opacity-60"
            title={item.title}
          >
            {item.title}
          </button>
        </div>

        {item.pageNumber !== null && (
          <button
            type="button"
            onClick={() => onSelectPage(item.pageNumber!)}
            className="shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-blue-500"
          >
            {item.pageNumber}
          </button>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-0.5 mt-0.5">
          {item.children.map((child, idx) => (
            <TocTreeNode
              key={`${child.title}-${idx}`}
              item={child}
              level={level + 1}
              filterQuery={filterQuery}
              activeTocPage={activeTocPage}
              onSelectPage={onSelectPage}
            />
          ))}
        </div>
      )}
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
  forceVisible?: boolean;
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
  forceVisible = false,
  onSelectNote,
  registerPageEl,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(forceVisible || pageNumber <= 3);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: Math.floor(defaultPageSize.width * scale),
    height: Math.floor(defaultPageSize.height * scale),
  });

  useEffect(() => {
    if (forceVisible) {
      setIsVisible(true);
    }
  }, [forceVisible]);

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
    if (forceVisible) return;
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
  }, [forceVisible]);

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
