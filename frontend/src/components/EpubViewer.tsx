import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Type,
  X,
  Highlighter,
  Loader2,
} from 'lucide-react';
import {
  BoundingBox,
  DocumentItem,
  EpubChapterItem,
  ReadingNote,
  UpdateReadingProgressPayload,
  formatDocTitle,
} from '../types';
import { api } from '../api';

interface EpubViewerProps {
  document: DocumentItem;
  notes: ReadingNote[];
  targetJump: { page: number; noteId?: string; timestamp: number } | null;
  inspectorOpen: boolean;
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

type ReaderTheme = 'dark' | 'sepia' | 'light';
type FontFamily = 'serif' | 'sans' | 'mono';

const THEME_STYLES: Record<ReaderTheme, { bg: string; text: string; name: string }> = {
  dark: { bg: '#0f172a', text: '#e2e8f0', name: 'Dunkel' },
  sepia: { bg: '#fbf0d9', text: '#433422', name: 'Sepia' },
  light: { bg: '#ffffff', text: '#1e293b', name: 'Hell' },
};

const FONT_FAMILIES: Record<FontFamily, { css: string; name: string }> = {
  serif: { css: 'Georgia, Cambria, "Times New Roman", Times, serif', name: 'Serif' },
  sans: { css: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', name: 'Sans' },
  mono: { css: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', name: 'Mono' },
};

export const EpubViewer: React.FC<EpubViewerProps> = ({
  document: docItem,
  notes,
  targetJump,
  inspectorOpen,
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
  const [chapters, setChapters] = useState<EpubChapterItem[]>([]);
  const [currentChapter, setCurrentChapter] = useState<number>(docItem.lastReadPage || 1);
  const [chapterHtml, setChapterHtml] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('pdforever.epub.fontSize');
    return saved ? parseInt(saved, 10) : 18;
  });
  const [theme, setTheme] = useState<ReaderTheme>(() => {
    const saved = localStorage.getItem('pdforever.epub.theme') as ReaderTheme;
    return saved && THEME_STYLES[saved] ? saved : 'dark';
  });
  const [fontFamily, setFontFamily] = useState<FontFamily>(() => {
    const saved = localStorage.getItem('pdforever.epub.fontFamily') as FontFamily;
    return saved && FONT_FAMILIES[saved] ? saved : 'serif';
  });

  const [selectionData, setSelectionData] = useState<{
    text: string;
    rect: { top: number; left: number };
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Load chapters list on mount or document switch
  useEffect(() => {
    let active = true;
    api.getEpubChapters(docItem.id)
      .then((items) => {
        if (!active) return;
        setChapters(items);
        const initial = docItem.lastReadPage && docItem.lastReadPage >= 1 && docItem.lastReadPage <= items.length
          ? docItem.lastReadPage
          : 1;
        setCurrentChapter(initial);
      })
      .catch((err) => {
        console.error('Failed to load EPUB chapters:', err);
      });
    return () => {
      active = false;
    };
  }, [docItem.id, docItem.lastReadPage]);

  // Load HTML for current chapter
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSelectionData(null);
    api.getEpubChapterHtml(docItem.id, currentChapter)
      .then((html) => {
        if (!active) return;
        setChapterHtml(html);
        setLoading(false);
        // Scroll to top of reading pane
        if (containerRef.current) {
          containerRef.current.scrollTop = 0;
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error('Failed loading chapter HTML:', err);
        setChapterHtml('<div style="padding: 2rem; color: #ef4444;">Kapitel konnte nicht geladen werden.</div>');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [docItem.id, currentChapter]);

  // React to targetJump (TOC, Notes, Search Results)
  useEffect(() => {
    if (targetJump && targetJump.page >= 1) {
      if (targetJump.page !== currentChapter) {
        changeChapter(targetJump.page);
      }
    }
  }, [targetJump]);

  const changeChapter = useCallback((newIndex: number) => {
    if (newIndex < 1) return;
    const max = Math.max(1, chapters.length || docItem.pageCount || 1);
    const clamped = Math.min(newIndex, max);
    setCurrentChapter(clamped);
    if (onPageChange) onPageChange(clamped);
    if (onUpdateProgress) {
      onUpdateProgress(docItem.id, {
        lastReadPage: clamped,
        readingStatus: clamped >= max ? 'COMPLETED' : 'READING',
      });
    }
  }, [chapters.length, docItem.id, docItem.pageCount, onPageChange, onUpdateProgress]);

  // Keyboard navigation (ArrowLeft / ArrowRight)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        changeChapter(currentChapter - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        changeChapter(currentChapter + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeChapter, currentChapter]);

  // Text selection tracking
  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !containerRef.current) {
      setSelectionData(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 2) {
      setSelectionData(null);
      return;
    }
    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      setSelectionData({
        text,
        rect: {
          top: rect.top - containerRect.top + containerRef.current.scrollTop - 42,
          left: Math.max(10, rect.left - containerRect.left + rect.width / 2 - 60),
        },
      });
    } catch {
      setSelectionData(null);
    }
  };

  const handleCreateNoteFromSelection = () => {
    if (!selectionData) return;
    onRequestCreateNote({
      documentId: docItem.id,
      pageNumber: currentChapter,
      selectedText: selectionData.text,
      boundingBox: { x1: 0, y1: 0, x2: 0, y2: 0 },
    });
    setSelectionData(null);
  };

  const currentChapterTitle = useMemo(() => {
    if (!chapters.length) return `Kapitel ${currentChapter}`;
    const found = chapters.find((c) => c.index === currentChapter);
    return found ? found.title : `Kapitel ${currentChapter}`;
  }, [chapters, currentChapter]);

  // Notes for this chapter
  const currentChapterNotes = useMemo(() => {
    return notes.filter((n) => n.pageNumber === currentChapter);
  }, [notes, currentChapter]);

  const changeFontSize = (delta: number) => {
    setFontSize((prev) => {
      const next = Math.max(12, Math.min(32, prev + delta));
      localStorage.setItem('pdforever.epub.fontSize', String(next));
      return next;
    });
  };

  const switchTheme = (nextTheme: ReaderTheme) => {
    setTheme(nextTheme);
    localStorage.setItem('pdforever.epub.theme', nextTheme);
  };

  const switchFontFamily = (nextFamily: FontFamily) => {
    setFontFamily(nextFamily);
    localStorage.setItem('pdforever.epub.fontFamily', nextFamily);
  };

  const totalChapters = Math.max(1, chapters.length || docItem.pageCount || 1);
  const themeStyle = THEME_STYLES[theme];

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden select-text bg-slate-900 text-slate-100">
      {/* Top Toolbar */}
      <div className="flex-none flex items-center justify-between px-3 py-2 border-b border-slate-700/60 bg-slate-800/90 backdrop-blur-sm z-20 text-xs gap-2">
        {/* Left: Badge, Title & Chapter Info */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-none px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
            EPUB
          </span>
          <span className="truncate font-medium text-slate-200 max-w-[200px] sm:max-w-[280px]" title={docItem.fileName}>
            {formatDocTitle(docItem)}
          </span>
          <span className="text-slate-500 hidden md:inline">•</span>
          <span className="text-slate-400 truncate hidden md:inline text-[11px]">
            {currentChapterTitle}
          </span>
        </div>

        {/* Center: Chapter Navigation */}
        <div className="flex items-center gap-1 bg-slate-900/60 p-0.5 rounded-lg border border-slate-700/60">
          <button
            type="button"
            onClick={() => changeChapter(currentChapter - 1)}
            disabled={currentChapter <= 1}
            className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-700/50 disabled:opacity-30 disabled:pointer-events-none"
            title="Vorheriges Kapitel (Pfeiltaste links)"
          >
            <ChevronLeft size={16} />
          </button>

          {chapters.length > 0 ? (
            <select
              value={currentChapter}
              onChange={(e) => changeChapter(parseInt(e.target.value, 10))}
              className="bg-transparent text-slate-200 text-xs px-2 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[130px] sm:max-w-[220px] truncate"
            >
              {chapters.map((ch) => (
                <option key={ch.index} value={ch.index} className="bg-slate-800 text-slate-200">
                  {ch.index}. {ch.title}
                </option>
              ))}
            </select>
          ) : (
            <span className="px-2 text-slate-300 font-mono text-[11px]">
              {currentChapter} / {totalChapters}
            </span>
          )}

          <button
            type="button"
            onClick={() => changeChapter(currentChapter + 1)}
            disabled={currentChapter >= totalChapters}
            className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-700/50 disabled:opacity-30 disabled:pointer-events-none"
            title="Nächstes Kapitel (Pfeiltaste rechts)"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Right: Typography Controls & Panes */}
        <div className="flex items-center gap-1">
          {/* Font Size controls */}
          <div className="flex items-center bg-slate-900/60 rounded border border-slate-700/60 px-1">
            <button
              type="button"
              onClick={() => changeFontSize(-1)}
              className="px-1.5 py-0.5 hover:text-white text-slate-300 font-semibold"
              title="Schrift verkleinern"
            >
              A-
            </button>
            <span className="text-[10px] text-slate-400 px-1 font-mono">{fontSize}</span>
            <button
              type="button"
              onClick={() => changeFontSize(1)}
              className="px-1.5 py-0.5 hover:text-white text-slate-300 font-semibold"
              title="Schrift vergrößern"
            >
              A+
            </button>
          </div>

          {/* Font Family selector */}
          <div className="hidden lg:flex items-center bg-slate-900/60 rounded border border-slate-700/60 p-0.5">
            {(['serif', 'sans', 'mono'] as FontFamily[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => switchFontFamily(f)}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  fontFamily === f ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {FONT_FAMILIES[f].name}
              </button>
            ))}
          </div>

          {/* Theme toggles */}
          <div className="flex items-center bg-slate-900/60 rounded border border-slate-700/60 p-0.5">
            <button
              type="button"
              onClick={() => switchTheme('dark')}
              className={`px-1.5 py-0.5 rounded text-[10px] ${
                theme === 'dark' ? 'bg-slate-700 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Dunkles Design"
            >
              Dark
            </button>
            <button
              type="button"
              onClick={() => switchTheme('sepia')}
              className={`px-1.5 py-0.5 rounded text-[10px] ${
                theme === 'sepia' ? 'bg-[#e5d8be] text-[#433422] font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Sepia (Augenfreundlich)"
            >
              Sepia
            </button>
            <button
              type="button"
              onClick={() => switchTheme('light')}
              className={`px-1.5 py-0.5 rounded text-[10px] ${
                theme === 'light' ? 'bg-white text-slate-900 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Helles Design"
            >
              Hell
            </button>
          </div>

          {/* Secondary document dropdown if split view */}
          {isSecondaryPane && availableDocuments.length > 0 && onChangeSecondaryDocument && (
            <select
              value={docItem.id}
              onChange={(e) => onChangeSecondaryDocument(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2 py-0.5 rounded focus:outline-none"
            >
              {availableDocuments.map((d) => (
                <option key={d.id} value={d.id}>
                  {formatDocTitle(d)}
                </option>
              ))}
            </select>
          )}

          {/* Split view toggle / close */}
          {onToggleSplitView && !isSecondaryPane && (
            <button
              type="button"
              onClick={onToggleSplitView}
              className={`p-1 rounded hover:bg-slate-700/50 ${isSplitView ? 'text-indigo-400' : 'text-slate-400'}`}
              title="Geteilte Ansicht (Split-View)"
            >
              <Columns size={15} />
            </button>
          )}

          {isSecondaryPane && onCloseSecondaryPane && (
            <button
              type="button"
              onClick={onCloseSecondaryPane}
              className="p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-rose-400"
              title="Sekundären Reader schließen"
            >
              <X size={15} />
            </button>
          )}

          {/* Fullscreen */}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
              title={isFullscreen ? 'Vollbild beenden' : 'Vollbildmodus'}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}

          {/* Right Inspector */}
          {onToggleInspector && (
            <button
              type="button"
              onClick={onToggleInspector}
              className={`p-1 rounded hover:bg-slate-700/50 ${inspectorOpen ? 'text-indigo-400' : 'text-slate-400'}`}
              title="Rechte Seitenleiste (Details / Notizen)"
            >
              {inspectorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            </button>
          )}
        </div>
      </div>

      {/* Reader Body with Scroll Container */}
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="relative flex-1 overflow-y-auto w-full transition-colors duration-200"
        style={{
          backgroundColor: themeStyle.bg,
          color: themeStyle.text,
        }}
      >
        {/* Floating selection tooltip for creating notes */}
        {selectionData && (
          <div
            className="absolute z-30 transform -translate-x-1/2 flex items-center gap-1.5 bg-slate-900/95 text-white border border-indigo-500/50 rounded-lg px-2.5 py-1.5 shadow-xl backdrop-blur-sm cursor-pointer hover:bg-indigo-600 transition-all text-xs"
            style={{
              top: `${selectionData.rect.top}px`,
              left: `${selectionData.rect.left}px`,
            }}
            onClick={handleCreateNoteFromSelection}
          >
            <Highlighter size={13} className="text-amber-400" />
            <span className="font-medium">Lesezettel erstellen</span>
          </div>
        )}

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs z-10">
            <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700 px-4 py-2 rounded-xl text-slate-300 shadow-xl">
              <Loader2 className="animate-spin text-indigo-400" size={18} />
              <span className="text-sm">Kapitel wird geladen...</span>
            </div>
          </div>
        )}

        {/* Chapter Content Wrapper */}
        <div className="max-w-3xl mx-auto px-6 py-10 min-h-full">
          {/* Notes badge banner if current chapter has notes */}
          {currentChapterNotes.length > 0 && (
            <div className="mb-6 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs flex items-center justify-between text-amber-300">
              <span className="flex items-center gap-1.5 font-medium">
                <Highlighter size={14} />
                {currentChapterNotes.length} Lesezettel in diesem Kapitel
              </span>
              <div className="flex items-center gap-1">
                {currentChapterNotes.slice(0, 3).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => onSelectNote(n)}
                    className="truncate max-w-[120px] bg-amber-500/20 hover:bg-amber-500/30 px-1.5 py-0.5 rounded text-[11px] text-amber-200"
                    title={n.selectedText || n.noteMarkdown}
                  >
                    "{n.selectedText?.slice(0, 15)}..."
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* HTML Render Container */}
          <div
            className="epub-reader-content prose max-w-none transition-all duration-150"
            style={{
              fontSize: `${fontSize}px`,
              lineHeight: 1.75,
              fontFamily: FONT_FAMILIES[fontFamily].css,
              color: themeStyle.text,
            }}
            dangerouslySetInnerHTML={{ __html: chapterHtml }}
          />

          {/* Chapter Bottom Navigation Footer */}
          <div className="mt-12 pt-6 border-t border-slate-700/30 flex items-center justify-between text-xs text-slate-400">
            <button
              type="button"
              onClick={() => changeChapter(currentChapter - 1)}
              disabled={currentChapter <= 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700/60 hover:bg-slate-800 hover:text-white disabled:opacity-20 disabled:pointer-events-none"
            >
              <ChevronLeft size={14} /> Vorheriges Kapitel
            </button>
            <span className="font-mono text-[11px]">
              {currentChapter} von {totalChapters}
            </span>
            <button
              type="button"
              onClick={() => changeChapter(currentChapter + 1)}
              disabled={currentChapter >= totalChapters}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700/60 hover:bg-slate-800 hover:text-white disabled:opacity-20 disabled:pointer-events-none"
            >
              Nächstes Kapitel <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

