import React, { useState } from 'react';
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
} from 'lucide-react';
import { AppSettings } from '../types';
import { api } from '../api';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  darkMode: boolean;
  onUpdateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  onToggleDarkMode: (dark: boolean) => void;
  onClose: () => void;
  onCoversCleared?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  darkMode,
  onUpdateSettings,
  onToggleDarkMode,
  onClose,
  onCoversCleared,
}) => {
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

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

