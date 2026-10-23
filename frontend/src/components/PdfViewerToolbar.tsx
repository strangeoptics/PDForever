import React from 'react';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  ScrollText,
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
import { DocumentItem, ReaderViewMode, ReadingStatus } from '../types';

export interface PdfViewerToolbarProps {
  docItem: DocumentItem;
  isSecondaryPane: boolean;
  availableDocuments: DocumentItem[];
  onChangeSecondaryDocument?: (docId: string) => void;
  currentStatus: ReadingStatus;
  readingPercent: number;
  onCycleReadingStatus?: () => void;
  currentPage: number;
  pageInput: string;
  onPageInputChange: (val: string) => void;
  onGoToPage: (page: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  pagesToRender: number[];
  numPages: number;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  viewMode: ReaderViewMode;
  onSetViewMode: (mode: ReaderViewMode) => void;
  isSplitView: boolean;
  onToggleSplitView?: () => void;
  onCloseSecondaryPane?: () => void;
  inspectorOpen: boolean;
  onToggleInspector?: () => void;
}

export const PdfViewerToolbar: React.FC<PdfViewerToolbarProps> = ({
  docItem,
  isSecondaryPane,
  availableDocuments,
  onChangeSecondaryDocument,
  currentStatus,
  readingPercent,
  onCycleReadingStatus,
  currentPage,
  pageInput,
  onPageInputChange,
  onGoToPage,
  onPrevPage,
  onNextPage,
  pagesToRender,
  numPages,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  viewMode,
  onSetViewMode,
  isSplitView,
  onToggleSplitView,
  onCloseSecondaryPane,
  inspectorOpen,
  onToggleInspector,
}) => {
  return (
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
          {onCycleReadingStatus && (
            <button
              onClick={onCycleReadingStatus}
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
            onClick={onPrevPage}
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
              if (!Number.isNaN(parsed)) onGoToPage(parsed);
            }}
            className="flex items-center gap-1 text-xs"
          >
            <input
              type="text"
              value={pageInput}
              onChange={(e) => onPageInputChange(e.target.value)}
              className="w-11 text-center rounded border border-slate-300 dark:border-slate-700 bg-transparent py-1 text-xs font-medium"
            />
            <span className="text-slate-500 dark:text-slate-400 font-mono">
              {pagesToRender.length === 2
                ? `–${pagesToRender[1]} / ${numPages}`
                : `/ ${numPages}`}
            </span>
          </form>

          <button
            onClick={onNextPage}
            disabled={pagesToRender[pagesToRender.length - 1] >= numPages}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
            title="Nächste Seite"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-0.5" />

          <button
            onClick={onZoomOut}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Verkleinern"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={onResetZoom}
            className="text-xs font-mono w-11 text-center py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Zoom auf 100% zurücksetzen"
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          <button
            onClick={onZoomIn}
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
              onClick={() => onSetViewMode('continuous')}
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
              onClick={() => onSetViewMode('single')}
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
              onClick={() => onSetViewMode('spread')}
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
              onClick={() => onSetViewMode('book')}
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
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${readingPercent}%` }}
        />
      </div>
    </div>
  );
};

