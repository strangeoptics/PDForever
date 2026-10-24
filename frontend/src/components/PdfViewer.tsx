import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Loader2 } from 'lucide-react';
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
import { TocTreeNode, countTocItems, findActiveTocPage } from './TocTreeNode';
import { PdfPageSurface } from './PdfPageSurface';
import { PdfViewerToolbar } from './PdfViewerToolbar';
import {
  FloatingSelectionButton,
  FloatingSelectionData,
} from './FloatingSelectionButton';

export { TocTreeNode, countTocItems, findActiveTocPage };

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
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
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
  isFullscreen,
  onToggleFullscreen,
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
  const [floatingMenu, setFloatingMenu] = useState<FloatingSelectionData | null>(null);
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
      <PdfViewerToolbar
        docItem={docItem}
        isSecondaryPane={isSecondaryPane}
        availableDocuments={availableDocuments}
        onChangeSecondaryDocument={onChangeSecondaryDocument}
        currentStatus={currentStatus}
        readingPercent={readingPercent}
        onCycleReadingStatus={onUpdateProgress ? cycleReadingStatus : undefined}
        currentPage={currentPage}
        pageInput={pageInput}
        onPageInputChange={setPageInput}
        onGoToPage={goToPage}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        pagesToRender={pagesToRender}
        numPages={numPages}
        zoomLevel={zoomLevel}
        onZoomIn={() => updateDocZoom((z) => z + 0.15)}
        onZoomOut={() => updateDocZoom((z) => z - 0.15)}
        onResetZoom={() => updateDocZoom(() => 1.0)}
        viewMode={viewMode}
        onSetViewMode={setViewMode}
        isSplitView={isSplitView}
        onToggleSplitView={onToggleSplitView}
        onCloseSecondaryPane={onCloseSecondaryPane}
        inspectorOpen={inspectorOpen}
        onToggleInspector={onToggleInspector}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />

      {/* Floating Selection Menu: Add Reading Note from selected text */}
      <FloatingSelectionButton
        data={floatingMenu}
        onAddNote={(noteData) => {
          onRequestCreateNote({
            documentId: docItem.id,
            pageNumber: noteData.pageNumber,
            selectedText: noteData.selectedText,
            boundingBox: noteData.boundingBox,
          });
        }}
        onClear={() => setFloatingMenu(null)}
      />

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
