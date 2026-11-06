import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import {
  AdRemovalReport,
  AppSettings,
  DocumentItem,
  PageAdAnalysis,
} from '../types';
import { api } from '../api';

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

  const [validationError, setValidationError] = useState<string | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [applyingClean, setApplyingClean] = useState<boolean>(false);
  const [pagesProgress, setPagesProgress] = useState<PageAdAnalysis[]>([]);
  const [report, setReport] = useState<AdRemovalReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) {
      setModelInput(settings.adVlmModel ?? 'qwen2.5vl');
      setOllamaUrlInput(settings.customOllamaUrl ?? 'http://127.0.0.1:11434');
      setMinConfidenceInput(String(settings.adMinConfidence ?? 0.75));
      setDpiInput(String(settings.adRenderDpi ?? 140));
      setDryRun(settings.adDryRun ?? true);
      setValidationError(null);
    }
  }, [
    isOpen,
    settings.adVlmModel,
    settings.customOllamaUrl,
    settings.adMinConfidence,
    settings.adRenderDpi,
    settings.adDryRun,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-4"
      onClick={() => {
        if (!running) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-base text-slate-900 dark:text-slate-100 truncate">
                Ganzseitige Werbeanzeigen erkennen & entfernen (VLM)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {docItem.fileName} • {docItem.pageCount} Seiten • Originaldatei bleibt unverändert
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition"
            title="Schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Configuration Form */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Ollama-Modellname (VLM)
                </label>
                <input
                  type="text"
                  disabled={running}
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  placeholder="qwen2.5vl"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Ollama-Adresse
                </label>
                <input
                  type="text"
                  disabled={running}
                  value={ollamaUrlInput}
                  onChange={(e) => setOllamaUrlInput(e.target.value)}
                  placeholder="http://127.0.0.1:11434"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Mindestkonfidenz (0–1)
                </label>
                <input
                  type="number"
                  disabled={running}
                  min={0}
                  max={1}
                  step={0.05}
                  value={minConfidenceInput}
                  onChange={(e) => setMinConfidenceInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Rendering-Auflösung (DPI)
                </label>
                <input
                  type="number"
                  disabled={running}
                  min={1}
                  step={1}
                  value={dpiInput}
                  onChange={(e) => setDpiInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200/70 dark:border-slate-800/70">
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={running}
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4"
                />
                <div>
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Analyse ohne Speichern/Bereinigung (Dry-Run)
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Prüft alle Seiten mit dem VLM im Arbeitsspeicher (PNG), ohne sofort eine neue PDF anzulegen.
                  </span>
                </div>
              </label>

              <div className="flex items-center gap-2">
                {running ? (
                  <button
                    type="button"
                    onClick={handleStopRun}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-xs transition"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Analyse abbrechen
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartRun}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-xs transition"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {dryRun
                      ? 'Alle Seiten mit VLM prüfen (Dry-Run)'
                      : 'Alle Seiten prüfen & Bereinigte PDF erstellen'}
                  </button>
                )}
              </div>
            </div>

            {/* Protection Rules Notice */}
            <div className="flex items-start gap-2 rounded-lg bg-blue-500/5 border border-blue-500/20 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300">
              <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-100">
                  Aktive Schutzregeln (Vorrang vor Löschentscheidung):
                </span>{' '}
                Seite 1 (Cover) sowie Seiten mit mehr als 40 Wörtern und den eigenständigen Begriffen{' '}
                <code className="font-mono text-blue-600 dark:text-blue-400">inhaltsverzeichnis</code>,{' '}
                <code className="font-mono text-blue-600 dark:text-blue-400">inhalt</code>,{' '}
                <code className="font-mono text-blue-600 dark:text-blue-400">impressum</code> oder{' '}
                <code className="font-mono text-blue-600 dark:text-blue-400">editorial</code> werden
                immer geschützt. Dennoch wird jede Seite mit dem VLM geprüft und das Ergebnis angezeigt.
              </div>
            </div>

            {validationError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {errorMessage && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          {/* Progress & Summary Cards */}
          {(running || pagesProgress.length > 0) && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" />}
                    {running
                      ? `Prüfe Seite ${Math.min(analyzedCount + 1, totalPages)} von ${totalPages} mit VLM (${modelInput.trim()})…`
                      : `VLM-Analyse abgeschlossen (${analyzedCount} / ${totalPages} Seiten geprüft)`}
                  </span>
                  <span className="font-mono text-slate-500">{progressPercent}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-rose-500 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/40 dark:bg-slate-950/30">
                  <div className="text-[11px] text-slate-500">Geprüfte Seiten</div>
                  <div className="text-lg font-bold font-mono text-slate-900 dark:text-white">
                    {analyzedCount} / {totalPages}
                  </div>
                </div>
                <div className="rounded-xl border border-blue-500/20 p-3 bg-blue-500/5">
                  <div className="text-[11px] text-blue-600 dark:text-blue-400">
                    Geschützte Seiten
                  </div>
                  <div className="text-lg font-bold font-mono text-blue-600 dark:text-blue-400">
                    {protectedCount}
                  </div>
                </div>
                <div className="rounded-xl border border-rose-500/20 p-3 bg-rose-500/5">
                  <div className="text-[11px] text-rose-600 dark:text-rose-400">
                    Werbung (zu entfernen)
                  </div>
                  <div className="text-lg font-bold font-mono text-rose-600 dark:text-rose-400">
                    {markedRemovalCount}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-500/20 p-3 bg-emerald-500/5">
                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                    Erhaltene Seiten
                  </div>
                  <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {Math.max(0, analyzedCount - markedRemovalCount)}
                    {errorCount > 0 ? ` (${errorCount} Fehler)` : ''}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Banner when Cleaned PDF was created OR Button to create Cleaned PDF after Dry-Run */}
          {report && !running && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/60 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-3">
              {report.cleanedDocumentId ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        Bereinigte PDF-Datei erfolgreich erstellt: {report.cleanedFileName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        {report.cleanedRelativePath} • {report.keptPagesCount} Seiten erhalten •{' '}
                        {report.removedPagesCount} Werbeseiten entfernt
                        {report.logRelativePath ? ` • Log: ${report.logRelativePath}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (report.cleanedDocumentId) {
                          onCleanedDocumentCreated(report.cleanedDocumentId, false);
                          onClose();
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Bereinigte PDF öffnen
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (report.cleanedDocumentId) {
                          onCleanedDocumentCreated(report.cleanedDocumentId, true);
                          onClose();
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition"
                    >
                      <Columns2 className="w-3.5 h-3.5" />
                      Im Split-View vergleichen
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2.5">
                    <Info className="w-4 h-4 text-blue-500 shrink-0" />
                    <div className="text-xs text-slate-700 dark:text-slate-300">
                      <span className="font-semibold">Dry-Run abgeschlossen:</span>{' '}
                      {markedRemovalCount === 0
                        ? 'Keine ungeschützten Seiten wurden als Werbung markiert.'
                        : `${markedRemovalCount} Seite(n) zur Entfernung erkannt (${pagesProgress
                            .filter((p) => p.markedForRemoval)
                            .map((p) => `S. ${p.pageNumber}`)
                            .join(', ')}).`}
                      {report.logRelativePath && (
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                          Protokoll gespeichert unter: {report.logRelativePath}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={applyingClean}
                    onClick={handleApplyCleanedFromAnalysis}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition"
                  >
                    {applyingClean ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FilePlus2 className="w-3.5 h-3.5" />
                    )}
                    {applyingClean
                      ? 'Erstelle neue PDF…'
                      : 'Bereinigte PDF-Datei jetzt erstellen'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Page-by-Page Results Table */}
          {pagesProgress.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800/80 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 sticky top-0 z-10">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Seite</th>
                      <th className="py-2.5 px-3 font-semibold">Schutzstatus</th>
                      <th className="py-2.5 px-3 font-semibold">VLM-Urteil</th>
                      <th className="py-2.5 px-3 font-semibold">Konfidenz</th>
                      <th className="py-2.5 px-3 font-semibold">VLM-Begründung / Fehler</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Aktion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                    {pagesProgress.map((p) => (
                      <tr
                        key={p.pageNumber}
                        className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition ${
                          p.markedForRemoval ? 'bg-rose-500/5' : ''
                        }`}
                      >
                        <td className="py-2 px-3 font-mono font-semibold whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onJumpToPage(p.pageNumber)}
                            className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                            title={`Im PDF-Reader zu Seite ${p.pageNumber} springen`}
                          >
                            <Eye className="w-3 h-3" />
                            S. {p.pageNumber}
                          </button>
                        </td>

                        <td className="py-2 px-3 whitespace-nowrap">
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

                        <td className="py-2 px-3 whitespace-nowrap">
                          {p.vlmError ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              <AlertTriangle className="w-3 h-3" />
                              VLM-Fehler
                            </span>
                          ) : p.vlmIsAd ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                              Werbung (is_ad: true)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              Redaktionell (is_ad: false)
                            </span>
                          )}
                        </td>

                        <td className="py-2 px-3 font-mono whitespace-nowrap">
                          {p.vlmConfidence != null ? (
                            <span>{p.vlmConfidence.toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300 max-w-xs">
                          {p.vlmError ? (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              {p.vlmError}
                            </span>
                          ) : (
                            <span>{p.vlmReason}</span>
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
                              Behalten (Geschützt)
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
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
};
