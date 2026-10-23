import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Image as ImageIcon,
  Sun,
  Moon,
  BookOpen,
  BookOpenCheck,
  FileText,
  ScrollText,
  Trash2,
  Check,
  LayoutGrid,
  Columns,
  Sparkles,
  RefreshCw,
  Bot,
  Cpu,
  Copy,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { AppSettings, OllamaStatus } from '../types';
import { api } from '../api';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  darkMode: boolean;
  onUpdateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  onToggleDarkMode: (dark: boolean) => void;
  onClose: () => void;
  onCoversCleared?: () => void;
  onMetadataEnriched?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  darkMode,
  onUpdateSettings,
  onToggleDarkMode,
  onClose,
  onCoversCleared,
  onMetadataEnriched,
}) => {
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [enrichingAll, setEnrichingAll] = useState(false);
  const [enrichMessage, setEnrichMessage] = useState<string | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [checkingOllama, setCheckingOllama] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  useEffect(() => {
    if (isOpen) {
      checkStatus();
    }
  }, [isOpen, settings.customOllamaUrl]);

  const checkStatus = async () => {
    setCheckingOllama(true);
    try {
      const res = await api.getRagStatus(settings.customOllamaUrl);
      setOllamaStatus(res);
    } catch {
      setOllamaStatus({
        enabled: true,
        available: false,
        ollamaUrl: settings.customOllamaUrl || 'http://localhost:11434',
        currentModel: settings.ragModel || 'qwen2.5:14b',
        installedModels: [],
        message: 'Ollama ist offline oder nicht erreichbar.',
      });
    } finally {
      setCheckingOllama(false);
    }
  };

  const handleCopyCmd = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  if (!isOpen) return null;

  const handleClearCoverCache = async () => {
    setClearingCache(true);
    setCacheMessage(null);
    try {
      const res = await api.clearCoverCache();
      setCacheMessage(`${res.deleted} gespeicherte Cover-Vorschaubilder gelöscht.`);
      onCoversCleared?.();
    } catch {
      setCacheMessage('Cover-Cache konnte nicht geleert werden.');
    } finally {
      setClearingCache(false);
    }
  };

  const handleEnrichAll = async (force: boolean) => {
    setEnrichingAll(true);
    setEnrichMessage(null);
    try {
      const res = await api.enrichAllDocuments(force);
      setEnrichMessage(
        `${res.scanned} PDFs geprüft • ${res.identifiersDetected} DOIs/ISBNs erkannt • ${res.enriched} Dokumente angereichert.`
      );
      onMetadataEnriched?.();
    } catch {
      setEnrichMessage('Metadaten-Anreicherung konnte nicht durchgeführt werden.');
    } finally {
      setEnrichingAll(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Einstellungen
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Darstellung, Cover-Vorschau und Lese-Optionen anpassen
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
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Section 1: Document Cards & Cover-Vorschau */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
              Document Cards & Cover-Vorschau
            </h3>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 bg-slate-50/40 dark:bg-slate-950/30">
              {/* Toggle Cover Images */}
              <div className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label
                    htmlFor="toggle-show-covers"
                    className="text-sm font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
                  >
                    Cover-Bild auf Document Cards anzeigen
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Zeigt auf jeder Document Card automatisch die erste Seite des PDFs als Cover-Vorschau an.
                  </p>
                </div>

                <button
                  id="toggle-show-covers"
                  type="button"
                  role="switch"
                  aria-checked={settings.showCovers}
                  onClick={() =>
                    onUpdateSettings((prev) => ({ ...prev, showCovers: !prev.showCovers }))
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                    settings.showCovers ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      settings.showCovers ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Cover Layout Selection (when showCovers is active) */}
              {settings.showCovers && (
                <div className="p-4 space-y-2.5">
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Cover-Anordnung auf den Karten
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings((prev) => ({ ...prev, coverLayout: 'left' }))
                      }
                      className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left text-xs font-medium transition ${
                        settings.coverLayout === 'left'
                          ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <Columns className="w-4 h-4 shrink-0" />
                      <div>
                        <div className="font-semibold">Seitlich (Kompakt)</div>
                        <div className="text-[11px] opacity-75">Buchcover links, Details rechts</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings((prev) => ({ ...prev, coverLayout: 'top' }))
                      }
                      className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left text-xs font-medium transition ${
                        settings.coverLayout === 'top'
                          ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <LayoutGrid className="w-4 h-4 shrink-0" />
                      <div>
                        <div className="font-semibold">Groß (Galerie-Kachel)</div>
                        <div className="text-[11px] opacity-75">Großes Cover über dem Titel</div>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Clear Cover Cache */}
              <div className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                    Cover-Vorschau Cache
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Gespeicherte Cover-Thumbnails löschen und bei Bedarf neu aus den PDFs generieren.
                  </p>
                  {cacheMessage && (
                    <p className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1 pt-1">
                      <Check className="w-3 h-3" />
                      {cacheMessage}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleClearCoverCache}
                  disabled={clearingCache}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-50 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {clearingCache ? 'Wird geleert…' : 'Cache leeren'}
                </button>
              </div>
            </div>
          </section>

          {/* Section 2: Erscheinungsbild & PDF-Reader */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-amber-500" />
              Erscheinungsbild & PDF-Reader
            </h3>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 bg-slate-50/40 dark:bg-slate-950/30">
              {/* Theme Switch */}
              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Farbschema (Theme)
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Zwischen dunklem und hellem Erscheinungsbild wechseln.
                  </p>
                </div>
                <div className="inline-flex rounded-lg p-0.5 bg-slate-200/70 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => onToggleDarkMode(false)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
                      !darkMode
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                    Hell
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleDarkMode(true)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
                      darkMode
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5 text-blue-400" />
                    Dunkel
                  </button>
                </div>
              </div>

              {/* Default Reader Mode */}
              <div className="p-4 space-y-2.5">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Standard-Lesemodus
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Bevorzugte Seitenansicht beim Öffnen eines PDF-Dokuments.
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings((prev) => ({ ...prev, defaultViewMode: 'continuous' }))
                    }
                    className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition ${
                      settings.defaultViewMode === 'continuous'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <ScrollText className="w-3.5 h-3.5 text-blue-500" />
                    Fortlaufend
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings((prev) => ({ ...prev, defaultViewMode: 'single' }))
                    }
                    className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition ${
                      settings.defaultViewMode === 'single'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 text-amber-500" />
                    Einzelseite
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings((prev) => ({ ...prev, defaultViewMode: 'spread' }))
                    }
                    className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition ${
                      settings.defaultViewMode === 'spread'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
                    Doppelseite
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings((prev) => ({ ...prev, defaultViewMode: 'book' }))
                    }
                    className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition ${
                      settings.defaultViewMode === 'book'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <BookOpenCheck className="w-3.5 h-3.5 text-purple-500" />
                    Buchmodus
                  </button>
                </div>
              </div>
            </div>
          </section>
          {/* Section 3: Automatische Metadaten-Anreicherung (DOI & ISBN) */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              Automatische Metadaten-Anreicherung (DOI & ISBN)
            </h3>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 p-4 space-y-3">
              <div className="space-y-1">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  DOI- & ISBN-Erkennung über CrossRef, Semantic Scholar & OpenLibrary
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Analysiert automatisch die ersten 2–3 Seiten jedes PDFs nach DOIs und ISBNs (ohne die PDF-Dateien auf der Festplatte zu verändern) und lädt Titel, Autoren, Publikationsjahr und Abstract.
                </p>
              </div>

              {enrichMessage && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 bg-emerald-500/10 px-3 py-2 rounded-lg">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>{enrichMessage}</span>
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleEnrichAll(false)}
                  disabled={enrichingAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition shadow-xs"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${enrichingAll ? 'animate-spin' : ''}`} />
                  {enrichingAll ? 'Analysiere & frage APIs ab…' : 'Fehlende Metadaten anreichern'}
                </button>
                <button
                  type="button"
                  onClick={() => handleEnrichAll(true)}
                  disabled={enrichingAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-50 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${enrichingAll ? 'animate-spin' : ''}`} />
                  Alle PDFs neu scannen
                </button>
              </div>
            </div>
          </section>

          {/* Section 4: Lokales RAG / Ollama (Optional) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-purple-500" />
                Lokales RAG & KI-Assistent (Ollama)
              </h3>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                    ollamaStatus?.available
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                  }`}
                >
                  {ollamaStatus?.available ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      Ollama Online
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3 h-3 text-amber-500" />
                      Ollama Offline
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={checkStatus}
                  disabled={checkingOllama}
                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                  title="Verbindung neu prüfen"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingOllama ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 p-4 space-y-4">
              <div className="space-y-1">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span>Rein lokales RAG (100% datenschutzfreundlich)</span>
                  <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    Optional
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  PDForever funktioniert völlig unabhängig auch ohne Ollama. Wenn Ollama auf deinem Rechner läuft, kannst du im linken Sidebar-Tab „RAG“ präzise Fragen an das geöffnete Dokument oder deine gefilterte Bibliothek stellen – mit verlinkten Belegstellen [S. X].
                </p>
              </div>

              {/* Ollama URL & Model Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Ollama-Endpunkt
                  </label>
                  <input
                    type="text"
                    value={settings.customOllamaUrl ?? 'http://localhost:11434'}
                    onChange={(e) =>
                      onUpdateSettings((prev) => ({
                        ...prev,
                        customOllamaUrl: e.target.value.trim() || undefined,
                      }))
                    }
                    placeholder="http://localhost:11434"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-purple-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Modell (Empfohlen: qwen2.5:14b)
                  </label>
                  {ollamaStatus?.installedModels && ollamaStatus.installedModels.length > 0 ? (
                    <select
                      value={settings.ragModel || ollamaStatus.currentModel || 'qwen2.5:14b'}
                      onChange={(e) =>
                        onUpdateSettings((prev) => ({ ...prev, ragModel: e.target.value }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-purple-500"
                    >
                      {ollamaStatus.installedModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      {!ollamaStatus.installedModels.includes(settings.ragModel || '') && settings.ragModel && (
                        <option value={settings.ragModel}>{settings.ragModel} (benutzerdefiniert)</option>
                      )}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={settings.ragModel ?? 'qwen2.5:14b'}
                      onChange={(e) =>
                        onUpdateSettings((prev) => ({
                          ...prev,
                          ragModel: e.target.value.trim() || undefined,
                        }))
                      }
                      placeholder="qwen2.5:14b"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-purple-500"
                    />
                  )}
                </div>
              </div>

              {/* Offline hint and copyable command */}
              {!ollamaStatus?.available && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-500/5 p-3 space-y-2">
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Ollama antwortet derzeit nicht auf{' '}
                    <code className="font-mono text-[11px] bg-amber-500/10 px-1 py-0.5 rounded">
                      {settings.customOllamaUrl || 'http://localhost:11434'}
                    </code>
                    . Starte Ollama in deinem Terminal:
                  </p>
                  <div className="flex items-center justify-between gap-2 bg-slate-900 text-slate-200 px-3 py-1.5 rounded font-mono text-xs">
                    <span>ollama run {settings.ragModel || 'qwen2.5:14b'}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyCmd(`ollama run ${settings.ragModel || 'qwen2.5:14b'}`)}
                      className="p-1 hover:text-white transition"
                      title="Befehl kopieren"
                    >
                      {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-xs transition"
          >
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
};

