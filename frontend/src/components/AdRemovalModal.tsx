import React, { useState, useEffect, useRef } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  X,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  FilePlus2,
  ExternalLink,
  Columns2,
  Loader2,
  Play,
  Square,
  Eye,
  Info,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
} from 'lucide-react';
import {
  AdRemovalReport,
  AppSettings,
  DocumentItem,
  PageAdAnalysis,
} from '../types';
import { api } from '../api';

const pageThumbnailCache = new Map<string, string>();
const largePageCache = new Map<string, string>();

interface PdfPageThumbnailProps {
  docId: string;
  pageNumber: number;
  pdfDoc: PDFDocumentProxy | null;
  onEnlarge: () => void;
  onJumpToPage: () => void;
}

const PdfPageThumbnail: React.FC<PdfPageThumbnailProps> = ({
  docId,
  pageNumber,
  pdfDoc,
  onEnlarge,
  onJumpToPage,
}) => {
  const cacheKey = `${docId}:${pageNumber}`;
  const containerRef = useRef<HTMLButtonElement | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [dataUrl, setDataUrl] = useState<string | null>(
    () => pageThumbnailCache.get(cacheKey) || null
  );
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    const cached = pageThumbnailCache.get(cacheKey);
    if (cached) {
      setDataUrl(cached);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cacheKey]);

  useEffect(() => {
    if (!isVisible || dataUrl || failed || !pdfDoc) return;

    const cached = pageThumbnailCache.get(cacheKey);
    if (cached) {
      setDataUrl(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const unscaled = page.getViewport({ scale: 1 });
        const targetWidth = 280;
        const scale = unscaled.width > 0 ? targetWidth / unscaled.width : 0.45;
        const viewport = page.getViewport({ scale });

        const canvas = window.document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2d context');

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) {
          const renderedUrl = canvas.toDataURL('image/jpeg', 0.85);
          pageThumbnailCache.set(cacheKey, renderedUrl);
          setDataUrl(renderedUrl);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isVisible, dataUrl, failed, pdfDoc, pageNumber, cacheKey]);

  return (
    <div className="inline-flex items-center gap-2.5 text-left">
      <button
        ref={containerRef}
        type="button"
        onClick={onEnlarge}
        title={`Seite ${pageNumber} groß anzeigen`}
        className="group relative w-[88px] h-[120px] rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center shadow-xs hover:ring-2 hover:ring-rose-500 focus:outline-none transition cursor-zoom-in"
      >
        {dataUrl ? (
          <>
            <img
              src={dataUrl}
              alt={`Seite ${pageNumber}`}
              className="w-full h-full object-contain bg-white"
            />
            <span className="absolute inset-0 bg-slate-950/0 group-hover:bg-slate-950/25 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
              <span className="p-1.5 rounded-full bg-slate-900/80 text-white shadow-md">
                <ZoomIn className="w-4 h-4" />
              </span>
            </span>
          </>
        ) : failed ? (
          <span className="text-[10px] text-slate-400 font-mono">S.{pageNumber}</span>
        ) : (
          <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
        )}
      </button>
      <button
        type="button"
        onClick={onJumpToPage}
        title={`Seite ${pageNumber} im PDF-Reader öffnen`}
        className="inline-flex items-center gap-1 font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
      >
        <Eye className="w-3.5 h-3.5" />
        S. {pageNumber}
      </button>
    </div>
  );
};

interface EnlargedPageModalProps {
  docId: string;
  pageAnalysis: PageAdAnalysis;
  pdfDoc: PDFDocumentProxy | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onJumpToPage: (pageNumber: number) => void;
  onClose: () => void;
}

const EnlargedPageModal: React.FC<EnlargedPageModalProps> = ({
  docId,
  pageAnalysis,
  pdfDoc,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onJumpToPage,
  onClose,
}) => {
  const pageNumber = pageAnalysis.pageNumber;
  const cacheKey = `${docId}:${pageNumber}`;
  const [imageUrl, setImageUrl] = useState<string | null>(
    () => largePageCache.get(cacheKey) || pageThumbnailCache.get(cacheKey) || null
  );
  const [loadingHiRes, setLoadingHiRes] = useState<boolean>(!largePageCache.has(cacheKey));

  useEffect(() => {
    const cachedHiRes = largePageCache.get(cacheKey);
    if (cachedHiRes) {
      setImageUrl(cachedHiRes);
      setLoadingHiRes(false);
      return;
    }

    const fallbackThumb = pageThumbnailCache.get(cacheKey) || null;
    setImageUrl(fallbackThumb);

    if (!pdfDoc) {
      setLoadingHiRes(false);
      return;
    }

    let cancelled = false;
    setLoadingHiRes(true);

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const unscaled = page.getViewport({ scale: 1 });
        const targetWidth = 1200;
        const scale = unscaled.width > 0 ? targetWidth / unscaled.width : 1.5;
        const viewport = page.getViewport({ scale });

        const canvas = window.document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2d context');

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) {
          const renderedUrl = canvas.toDataURL('image/jpeg', 0.92);
          largePageCache.set(cacheKey, renderedUrl);
          setImageUrl(renderedUrl);
          setLoadingHiRes(false);
        }
      } catch {
        if (!cancelled) {
          setLoadingHiRes(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, pageNumber, pdfDoc]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        e.stopPropagation();
        onPrev();
      } else if (e.key === 'ArrowRight' && hasNext) {
        e.stopPropagation();
        onNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-xs p-3"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-[94vh] max-h-[94vh] rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 shrink-0">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <span className="font-mono font-bold text-sm text-white">
              Seite {pageNumber}
            </span>

            {pageAnalysis.protectedPage && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                <ShieldCheck className="w-3 h-3" />
                {pageAnalysis.protectionReason || 'Geschützt'}
              </span>
            )}

            {pageAnalysis.vlmError ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                <AlertTriangle className="w-3 h-3" />
                VLM-Fehler
              </span>
            ) : pageAnalysis.vlmIsAd ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/20 text-rose-300 border border-rose-500/30">
                Werbung
                {pageAnalysis.vlmConfidence != null
                  ? ` (${pageAnalysis.vlmConfidence.toFixed(2)})`
                  : ''}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Redaktionell
                {pageAnalysis.vlmConfidence != null
                  ? ` (${pageAnalysis.vlmConfidence.toFixed(2)})`
                  : ''}
              </span>
            )}

            {pageAnalysis.markedForRemoval ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-600 text-white">
                <Trash2 className="w-3 h-3" />
                Wird entfernt
              </span>
            ) : (
              <span className="text-[11px] font-medium text-emerald-400">
                Wird behalten
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!hasPrev}
              onClick={onPrev}
              className="p-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-35 transition"
              title="Vorherige Seite (Pfeil links)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={!hasNext}
              onClick={onNext}
              className="p-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-35 transition"
              title="Nächste Seite (Pfeil rechts)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onJumpToPage(pageNumber)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition ml-1"
              title={`Im PDF-Reader zu Seite ${pageNumber} springen`}
            >
              <Eye className="w-3.5 h-3.5" />
              Im Reader öffnen
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition ml-1"
              title="Großansicht schließen (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Optional VLM Reason / Error Subtitle */}
        {(pageAnalysis.vlmReason || pageAnalysis.vlmError) && (
          <div className="px-4 py-1.5 text-xs bg-slate-900 border-b border-slate-800 text-slate-300 shrink-0">
            {pageAnalysis.vlmError ? (
              <span className="text-amber-400">{pageAnalysis.vlmError}</span>
            ) : (
              <span>{pageAnalysis.vlmReason}</span>
            )}
          </div>
        )}

        {/* Large Page Image Area */}
        <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4 bg-slate-950/60 relative">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`Seite ${pageNumber} Großansicht`}
              className="max-h-full max-w-full object-contain rounded shadow-2xl bg-white"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-xs">Lade Seite {pageNumber}…</span>
            </div>
          )}
          {loadingHiRes && imageUrl && (
            <div className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/85 border border-slate-700 text-[11px] text-slate-300">
              <Loader2 className="w-3 h-3 animate-spin text-rose-400" />
              Schärfe nach…
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface AdRemovalModalProps {
  isOpen: boolean;
  document: DocumentItem;
  settings: AppSettings;
  onUpdateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  onClose: () => void;
  onJumpToPage: (pageNumber: number) => void;
  onCleanedDocumentCreated: (cleanedDocId: string, openInSplitView?: boolean) => void;
}

export const AdRemovalModal: React.FC<AdRemovalModalProps> = ({
  isOpen,
  document: docItem,
  settings,
  onUpdateSettings,
  onClose,
  onJumpToPage,
  onCleanedDocumentCreated,
}) => {
  const [modelInput, setModelInput] = useState<string>(settings.adVlmModel ?? 'qwen2.5vl');
  const [ollamaUrlInput, setOllamaUrlInput] = useState<string>(
    settings.customOllamaUrl ?? 'http://127.0.0.1:11434'
  );
  const [minConfidenceInput, setMinConfidenceInput] = useState<string>(
    String(settings.adMinConfidence ?? 0.75)
  );
  const [dpiInput, setDpiInput] = useState<string>(String(settings.adRenderDpi ?? 140));
  const [dryRun, setDryRun] = useState<boolean>(settings.adDryRun ?? true);
  const [includeReason, setIncludeReason] = useState<boolean>(settings.adIncludeReason ?? true);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [applyingClean, setApplyingClean] = useState<boolean>(false);
  const [pagesProgress, setPagesProgress] = useState<PageAdAnalysis[]>([]);
  const [report, setReport] = useState<AdRemovalReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [enlargedPageNumber, setEnlargedPageNumber] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let loadingTaskRef: { destroy: () => void } | null = null;
    let loadedDoc: PDFDocumentProxy | null = null;

    import('pdfjs-dist').then(async (pdfjsLib) => {
      if (cancelled) return;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();

      const streamUrl = api.getStreamUrl(docItem.id);
      const loadingTask = pdfjsLib.getDocument({
        url: streamUrl,
        rangeChunkSize: 256 * 1024,
        disableAutoFetch: true,
        disableStream: false,
      });
      loadingTaskRef = loadingTask;

      try {
        const doc = await loadingTask.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        loadedDoc = doc;
        setPdfDoc(doc);
      } catch {
        // Ignore thumbnail loader errors
      }
    });

    return () => {
      cancelled = true;
      setPdfDoc(null);
      if (loadedDoc) {
        loadedDoc.destroy();
      } else if (loadingTaskRef) {
        loadingTaskRef.destroy();
      }
    };
  }, [isOpen, docItem.id]);

  useEffect(() => {
    if (isOpen) {
      setModelInput(settings.adVlmModel ?? 'qwen2.5vl');
      setOllamaUrlInput(settings.customOllamaUrl ?? 'http://127.0.0.1:11434');
      setMinConfidenceInput(String(settings.adMinConfidence ?? 0.75));
      setDpiInput(String(settings.adRenderDpi ?? 140));
      setDryRun(settings.adDryRun ?? true);
      setIncludeReason(settings.adIncludeReason ?? true);
      setValidationError(null);
    }
  }, [
    isOpen,
    settings.adVlmModel,
    settings.customOllamaUrl,
    settings.adMinConfidence,
    settings.adRenderDpi,
    settings.adDryRun,
    settings.adIncludeReason,
  ]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  if (!isOpen) return null;

  const validateInputs = (): {
    model: string;
    ollamaUrl: string;
    minConfidence: number;
    dpi: number;
    dryRun: boolean;
    includeReason: boolean;
  } | null => {
    const trimmedModel = modelInput.trim();
    if (!trimmedModel) {
      setValidationError('Bitte einen Ollama-Modellnamen angeben (Standard: qwen2.5vl).');
      return null;
    }

    const trimmedUrl = ollamaUrlInput.trim() || 'http://127.0.0.1:11434';
    if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
      setValidationError(
        'Bitte eine gültige Ollama-Adresse angeben (Standard: http://127.0.0.1:11434).'
      );
      return null;
    }

    const normalizedConfStr = minConfidenceInput.trim().replace(',', '.');
    const parsedConf = Number(normalizedConfStr);
    if (
      normalizedConfStr === '' ||
      !Number.isFinite(parsedConf) ||
      parsedConf < 0 ||
      parsedConf > 1
    ) {
      setValidationError('Mindestkonfidenz muss ein endlicher Wert zwischen 0 und 1 sein.');
      return null;
    }

    const trimmedDpiStr = dpiInput.trim();
    const parsedDpi = Number(trimmedDpiStr);
    if (
      !/^\d+$/.test(trimmedDpiStr) ||
      !Number.isSafeInteger(parsedDpi) ||
      parsedDpi <= 0
    ) {
      setValidationError('Rendering-Auflösung (DPI) muss eine positive Ganzzahl sein.');
      return null;
    }

    setValidationError(null);
    return {
      model: trimmedModel,
      ollamaUrl: trimmedUrl,
      minConfidence: parsedConf,
      dpi: parsedDpi,
      dryRun,
      includeReason,
    };
  };

  const handleStartRun = () => {
    const validated = validateInputs();
    if (!validated) return;

    // Persist settings without rewriting model name
    onUpdateSettings((prev) => ({
      ...prev,
      customOllamaUrl: validated.ollamaUrl,
      adVlmModel: validated.model,
      adMinConfidence: validated.minConfidence,
      adRenderDpi: validated.dpi,
      adDryRun: validated.dryRun,
      adIncludeReason: validated.includeReason,
    }));

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setRunning(true);
    setPagesProgress([]);
    setReport(null);
    setErrorMessage(null);

    api.streamAdRemoval(
      docItem.id,
      {
        ollamaUrl: validated.ollamaUrl,
        model: validated.model,
        minConfidence: validated.minConfidence,
        dpi: validated.dpi,
        dryRun: validated.dryRun,
        includeReason: validated.includeReason,
      },
      (pageAnalysis) => {
        setPagesProgress((prev) => {
          const filtered = prev.filter((p) => p.pageNumber !== pageAnalysis.pageNumber);
          return [...filtered, pageAnalysis].sort((a, b) => a.pageNumber - b.pageNumber);
        });
      },
      (finalReport) => {
        setReport(finalReport);
        if (finalReport.pages && finalReport.pages.length > 0) {
          setPagesProgress(finalReport.pages);
        }
      },
      (err) => {
        setErrorMessage(err);
      },
      () => {
        setRunning(false);
      },
      controller.signal
    );
  };

  const handleStopRun = () => {
    abortControllerRef.current?.abort();
    setRunning(false);
  };

  const handleApplyCleanedFromAnalysis = async () => {
    const pagesToRemove = pagesProgress
      .filter((p) => p.markedForRemoval && !p.protectedPage && !p.isCover)
      .map((p) => p.pageNumber);

    setApplyingClean(true);
    setErrorMessage(null);
    try {
      const appliedReport = await api.applyAdRemoval(docItem.id, {
        pagesToRemove,
      });
      setReport((prev) =>
        prev
          ? {
              ...prev,
              dryRun: false,
              cleanedDocumentId: appliedReport.cleanedDocumentId,
              cleanedFileName: appliedReport.cleanedFileName,
              cleanedRelativePath: appliedReport.cleanedRelativePath,
              removedPagesCount: appliedReport.removedPagesCount,
              keptPagesCount: appliedReport.keptPagesCount,
            }
          : appliedReport
      );
    } catch (err: any) {
      setErrorMessage(err?.message || 'Bereinigte PDF konnte nicht erstellt werden.');
    } finally {
      setApplyingClean(false);
    }
  };

  const totalPages = report?.totalPages || docItem.pageCount || 1;
  const analyzedCount = pagesProgress.length;
  const progressPercent = Math.min(100, Math.round((analyzedCount / Math.max(1, totalPages)) * 100));

  const protectedCount = pagesProgress.filter((p) => p.protectedPage).length;
  const markedRemovalCount = pagesProgress.filter((p) => p.markedForRemoval).length;
  const errorCount = pagesProgress.filter((p) => p.vlmError != null).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-3"
      onClick={() => {
        if (!running) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl h-[92vh] max-h-[92vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Compact Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex items-baseline gap-2">
              <h2 className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                Werbeanzeigen erkennen & entfernen (VLM)
              </h2>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate hidden sm:inline">
                • {docItem.fileName} ({docItem.pageCount} S.)
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition"
            title="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Upper Compact Controls & Status Area (shrink-0) */}
        <div className="px-4 py-2.5 space-y-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 shrink-0">
          {/* Row 1: 4 Settings Inputs in a single compact 12-col grid */}
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-4 sm:col-span-3">
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5 truncate">
                Modell (VLM)
              </label>
              <input
                type="text"
                disabled={running}
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                placeholder="qwen2.5vl"
                className="w-full px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="col-span-8 sm:col-span-5">
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5 truncate">
                Ollama-Adresse
              </label>
              <input
                type="text"
                disabled={running}
                value={ollamaUrlInput}
                onChange={(e) => setOllamaUrlInput(e.target.value)}
                placeholder="http://127.0.0.1:11434"
                className="w-full px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="col-span-6 sm:col-span-2">
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5 truncate">
                Konfidenz
              </label>
              <input
                type="number"
                disabled={running}
                min={0}
                max={1}
                step={0.05}
                value={minConfidenceInput}
                onChange={(e) => setMinConfidenceInput(e.target.value)}
                className="w-full px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="col-span-6 sm:col-span-2">
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5 truncate">
                DPI
              </label>
              <input
                type="number"
                disabled={running}
                min={1}
                step={1}
                value={dpiInput}
                onChange={(e) => setDpiInput(e.target.value)}
                className="w-full px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>
          </div>

          {/* Row 2: Dry-Run Checkbox + Protection hint + Action Button */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={running}
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-3.5 h-3.5"
                />
                <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Nur Analyse (Dry-Run)
                </span>
              </label>

              <label
                className="inline-flex items-center gap-1.5 cursor-pointer select-none"
                title="Wenn deaktiviert, generiert das LLM nur is_ad und confidence (schnellere Inferenz ohne Textbegründung)."
              >
                <input
                  type="checkbox"
                  disabled={running}
                  checked={includeReason}
                  onChange={(e) => setIncludeReason(e.target.checked)}
                  className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-3.5 h-3.5"
                />
                <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Begründung vom LLM generieren
                </span>
              </label>

              <span
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"
                title="Seite 1 (Cover) sowie Seiten mit > 40 Wörtern und den eigenständigen Begriffen inhaltsverzeichnis, inhalt, impressum oder editorial sind geschützt."
              >
                <ShieldCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                Schutz: Cover &amp; Inhalt/Impressum/Editorial (&gt;40 W.)
              </span>
            </div>

            <div className="flex items-center gap-2">
              {running ? (
                <button
                  type="button"
                  onClick={handleStopRun}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-xs transition"
                >
                  <Square className="w-3 h-3" />
                  Abbrechen
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartRun}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-xs transition"
                >
                  <Play className="w-3 h-3" />
                  {dryRun ? 'Alle Seiten prüfen (Dry-Run)' : 'Prüfen & Bereinigte PDF erstellen'}
                </button>
              )}
            </div>
          </div>

          {validationError && (
            <div className="flex items-center gap-1.5 rounded-md bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-1.5 rounded-md bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Compact Progress & Inline Pill Stats */}
          {(running || pagesProgress.length > 0) && (
            <div className="pt-1 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  {running && <Loader2 className="w-3 h-3 animate-spin text-rose-500" />}
                  {running
                    ? `Prüfe Seite ${Math.min(analyzedCount + 1, totalPages)}/${totalPages} (${modelInput.trim()})…`
                    : `Analyse fertig (${analyzedCount}/${totalPages} Seiten)`}
                </span>

                <div className="flex flex-wrap items-center gap-1.5 font-mono">
                  <span className="px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    Geprüft: <b>{analyzedCount}/{totalPages}</b> ({progressPercent}%)
                  </span>
                  <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    Geschützt: <b>{protectedCount}</b>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400">
                    Werbung: <b>{markedRemovalCount}</b>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    Behalten: <b>{Math.max(0, analyzedCount - markedRemovalCount)}</b>
                    {errorCount > 0 ? ` (${errorCount} Err)` : ''}
                  </span>
                </div>
              </div>

              <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-rose-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Compact Result Action Banner */}
          {report && !running && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
              {report.cleanedDocumentId ? (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div className="min-w-0 text-xs">
                      <span className="font-bold text-slate-900 dark:text-white">
                        Erstellt: {report.cleanedFileName}
                      </span>{' '}
                      <span className="text-[11px] text-slate-500 font-mono">
                        ({report.keptPagesCount} behalten, {report.removedPagesCount} entfernt
                        {report.logRelativePath ? ` • Log: ${report.logRelativePath}` : ''})
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (report.cleanedDocumentId) {
                          onCleanedDocumentCreated(report.cleanedDocumentId, false);
                          onClose();
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Öffnen
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (report.cleanedDocumentId) {
                          onCleanedDocumentCreated(report.cleanedDocumentId, true);
                          onClose();
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition"
                    >
                      <Columns2 className="w-3 h-3" />
                      Split-View
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <Info className="w-4 h-4 text-blue-500 shrink-0" />
                    <div className="text-xs text-slate-700 dark:text-slate-300 truncate">
                      <span className="font-semibold">Dry-Run:</span>{' '}
                      {markedRemovalCount === 0
                        ? 'Keine Werbung zum Entfernen markiert.'
                        : `${markedRemovalCount} Werbeseite(n) erkannt (${pagesProgress
                            .filter((p) => p.markedForRemoval)
                            .map((p) => `S.${p.pageNumber}`)
                            .join(', ')}).`}
                      {report.logRelativePath && (
                        <span className="text-[11px] text-slate-400 font-mono ml-1.5">
                          [Log: {report.logRelativePath}]
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={applyingClean}
                    onClick={handleApplyCleanedFromAnalysis}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition shrink-0"
                  >
                    {applyingClean ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <FilePlus2 className="w-3 h-3" />
                    )}
                    {applyingClean ? 'Erstelle PDF…' : 'Bereinigte PDF erstellen'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Full-Height Page-by-Page Results List (flex-1 min-h-0) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {pagesProgress.length > 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-100 dark:bg-slate-800/90 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 sticky top-0 z-10">
                  <tr>
                    <th className="py-2 px-3 font-semibold">Seite / Vorschau</th>
                    <th className="py-2 px-2.5 font-semibold">Schutz / Wörter</th>
                    <th className="py-2 px-2.5 font-semibold">VLM-Urteil</th>
                    <th className="py-2 px-2.5 font-semibold">Begründung / Fehler</th>
                    <th className="py-2 px-3 font-semibold text-right">Aktion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                  {pagesProgress.map((p) => (
                    <tr
                      key={p.pageNumber}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition align-middle ${
                        p.markedForRemoval ? 'bg-rose-500/5' : ''
                      }`}
                    >
                      <td className="py-2 px-3 font-mono font-semibold whitespace-nowrap">
                        <PdfPageThumbnail
                          docId={docItem.id}
                          pageNumber={p.pageNumber}
                          pdfDoc={pdfDoc}
                          onEnlarge={() => setEnlargedPageNumber(p.pageNumber)}
                          onJumpToPage={() => onJumpToPage(p.pageNumber)}
                        />
                      </td>

                      <td className="py-2 px-2.5 whitespace-nowrap">
                        {p.protectedPage ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                            title={p.protectionReason || 'Geschützt'}
                          >
                            <ShieldCheck className="w-3 h-3 shrink-0" />
                            {p.protectionReason || 'Geschützt'}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-mono">
                            {p.wordCount} Wörter
                          </span>
                        )}
                      </td>

                      <td className="py-2 px-2.5 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          {p.vlmError ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              <AlertTriangle className="w-3 h-3" />
                              VLM-Fehler
                            </span>
                          ) : p.vlmIsAd ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                              Werbung
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              Redaktionell
                            </span>
                          )}
                          {p.vlmConfidence != null && (
                            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 pl-1">
                              Konfidenz: {p.vlmConfidence.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2 px-2.5 text-slate-700 dark:text-slate-300 max-w-md">
                        {p.vlmError ? (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">
                            {p.vlmError}
                          </span>
                        ) : p.vlmReason ? (
                          <span>{p.vlmReason}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {p.markedForRemoval ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-600 text-white">
                            <Trash2 className="w-3 h-3" />
                            Entfernen
                          </span>
                        ) : p.protectedPage && p.vlmIsAd ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400">
                            <ShieldCheck className="w-3 h-3" />
                            Geschützt
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                            Behalten
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500 py-12">
              <Sparkles className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-xs">
                Klicke oben auf <b>„Alle Seiten prüfen“</b>, um die seitenweise VLM-Analyse mit Seitenvorschau zu starten.
              </p>
            </div>
          )}
        </div>
      </div>

      {enlargedPageNumber !== null && (() => {
        const currentIdx = pagesProgress.findIndex((p) => p.pageNumber === enlargedPageNumber);
        const currentPageAnalysis = currentIdx >= 0 ? pagesProgress[currentIdx] : null;
        if (!currentPageAnalysis) return null;
        return (
          <EnlargedPageModal
            docId={docItem.id}
            pageAnalysis={currentPageAnalysis}
            pdfDoc={pdfDoc}
            hasPrev={currentIdx > 0}
            hasNext={currentIdx < pagesProgress.length - 1}
            onPrev={() => {
              if (currentIdx > 0) {
                setEnlargedPageNumber(pagesProgress[currentIdx - 1].pageNumber);
              }
            }}
            onNext={() => {
              if (currentIdx < pagesProgress.length - 1) {
                setEnlargedPageNumber(pagesProgress[currentIdx + 1].pageNumber);
              }
            }}
            onJumpToPage={(pageNum) => {
              onJumpToPage(pageNum);
              setEnlargedPageNumber(null);
            }}
            onClose={() => setEnlargedPageNumber(null)}
          />
        );
      })()}
    </div>
  );
};
