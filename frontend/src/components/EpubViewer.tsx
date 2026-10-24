import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Columns,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
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

const THEME_STYLES: Record<
  ReaderTheme,
  {
    bg: string;
    text: string;
    name: string;
    highlightBg: string;
    highlightBorder: string;
    highlightHover: string;
    highlightActiveBg: string;
    highlightRing: string;
  }
> = {
  dark: {
    bg: '#0f172a',
    text: '#e2e8f0',
    name: 'Dunkel',
    highlightBg: 'rgba(245, 158, 11, 0.28)',
    highlightBorder: '#f59e0b',
    highlightHover: 'rgba(245, 158, 11, 0.45)',
    highlightActiveBg: 'rgba(245, 158, 11, 0.65)',
    highlightRing: 'rgba(245, 158, 11, 0.6)',
  },
  sepia: {
    bg: '#fbf0d9',
    text: '#433422',
    name: 'Sepia',
    highlightBg: 'rgba(217, 119, 6, 0.25)',
    highlightBorder: '#d97706',
    highlightHover: 'rgba(217, 119, 6, 0.42)',
    highlightActiveBg: 'rgba(217, 119, 6, 0.55)',
    highlightRing: 'rgba(217, 119, 6, 0.5)',
  },
  light: {
    bg: '#ffffff',
    text: '#1e293b',
    name: 'Hell',
    highlightBg: 'rgba(251, 191, 36, 0.45)',
    highlightBorder: '#f59e0b',
    highlightHover: 'rgba(251, 191, 36, 0.65)',
    highlightActiveBg: 'rgba(245, 158, 11, 0.7)',
    highlightRing: 'rgba(245, 158, 11, 0.5)',
  },
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
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingJumpNoteIdRef = useRef<string | null>(null);

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
        // Scroll to top of reading pane if not jumping to a specific note
        if (containerRef.current && !pendingJumpNoteIdRef.current) {
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

  // Notes belonging to this chapter
  const currentChapterNotes = useMemo(() => {
    return notes.filter((n) => n.pageNumber === currentChapter);
  }, [notes, currentChapter]);

  // Pulse animation helper for a highlighted element
  const pulseHighlight = useCallback((el: HTMLElement) => {
    el.classList.remove('epub-highlight-active');
    // Force DOM reflow to restart animation if already active
    void el.offsetWidth;
    el.classList.add('epub-highlight-active');
    setTimeout(() => {
      el.classList.remove('epub-highlight-active');
    }, 2200);
  }, []);

  // Scroll to a specific note's highlighted quote
  const scrollToNote = useCallback((noteId: string) => {
    const root = contentRef.current;
    if (!root) return;
    const mark = root.querySelector(`mark.epub-note-highlight[data-note-id="${noteId}"]`) as HTMLElement | null;
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      pulseHighlight(mark);
      pendingJumpNoteIdRef.current = null;
    }
  }, [pulseHighlight]);

  // Apply in-text highlights to the chapter DOM
  const applyHighlights = useCallback(() => {
    const root = contentRef.current;
    if (!root || !currentChapterNotes.length) return;

    // Remove existing highlights first to avoid duplicate wrappers
    const existingMarks = root.querySelectorAll('mark.epub-note-highlight');
    existingMarks.forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent?.insertBefore(mark.firstChild, mark);
      }
      parent?.removeChild(mark);
    });

    // Helper to find and wrap text occurrence
    const wrapOccurrence = (quote: string, note: ReadingNote) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const textNodes: Text[] = [];
      let cur: Node | null;
      while ((cur = walker.nextNode())) {
        if (cur.nodeValue && cur.nodeValue.length > 0) {
          textNodes.push(cur as Text);
        }
      }
      if (!textNodes.length) return;

      let fullText = '';
      const intervals: { node: Text; start: number; end: number }[] = [];
      for (const tn of textNodes) {
        const val = tn.nodeValue || '';
        const start = fullText.length;
        fullText += val;
        intervals.push({ node: tn, start, end: fullText.length });
      }

      let matchIndex = fullText.indexOf(quote);
      let matchLength = quote.length;

      if (matchIndex === -1) {
        matchIndex = fullText.toLowerCase().indexOf(quote.toLowerCase());
      }

      if (matchIndex === -1) {
        const escaped = quote
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\s+/g, '\\s+');
        try {
          const regex = new RegExp(escaped, 'i');
          const m = regex.exec(fullText);
          if (m) {
            matchIndex = m.index;
            matchLength = m[0].length;
          }
        } catch {
          // ignore regex fallback failure
        }
      }

      if (matchIndex === -1) return;

      const matchEnd = matchIndex + matchLength;
      const range = document.createRange();
      let startSet = false;
      let endSet = false;

      for (const { node, start, end } of intervals) {
        if (!startSet && matchIndex >= start && matchIndex < end) {
          range.setStart(node, matchIndex - start);
          startSet = true;
        }
        if (startSet && matchEnd <= end) {
          range.setEnd(node, matchEnd - start);
          endSet = true;
          break;
        }
      }

      if (startSet && endSet) {
        const mark = document.createElement('mark');
        mark.className = 'epub-note-highlight';
        mark.setAttribute('data-note-id', note.id);
        mark.setAttribute('tabindex', '0');
        mark.setAttribute(
          'title',
          note.noteMarkdown ? `Lesezettel: ${note.noteMarkdown.slice(0, 100)}` : 'Lesezettel anzeigen'
        );
        try {
          range.surroundContents(mark);
        } catch {
          try {
            const frag = range.extractContents();
            mark.appendChild(frag);
            range.insertNode(mark);
          } catch (err) {
            console.debug('Failed to wrap highlight mark:', err);
          }
        }
      }
    };

    // Apply highlights in order of current chapter notes
    currentChapterNotes.forEach((note) => {
      const quote = note.selectedText?.trim();
      if (quote && quote.length >= 2) {
        wrapOccurrence(quote, note);
      }
    });

    // If there is a pending jump note, scroll to it now
    if (pendingJumpNoteIdRef.current) {
      setTimeout(() => {
        if (pendingJumpNoteIdRef.current) {
          scrollToNote(pendingJumpNoteIdRef.current);
        }
      }, 100);
    }
  }, [currentChapterNotes, scrollToNote]);

  // Re-run highlighting whenever chapter HTML changes or chapter notes change
  useEffect(() => {
    if (!loading && chapterHtml) {
      applyHighlights();
    }
  }, [loading, chapterHtml, applyHighlights]);

  // React to targetJump (TOC, Notes, Search Results)
  useEffect(() => {
    if (!targetJump) return;
    const targetPage = targetJump.page >= 1 ? targetJump.page : 1;

    if (targetJump.noteId) {
      pendingJumpNoteIdRef.current = targetJump.noteId;
    }

    if (targetPage !== currentChapter) {
      changeChapter(targetPage);
    } else if (targetJump.noteId) {
      setTimeout(() => {
        scrollToNote(targetJump.noteId!);
      }, 100);
    }
  }, [targetJump, currentChapter, changeChapter, scrollToNote]);

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

  // Handle clicking on an in-text highlight
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('mark.epub-note-highlight');
    if (target) {
      const noteId = target.getAttribute('data-note-id');
      if (noteId) {
        const found = notes.find((n) => n.id === noteId);
        if (found) {
          onSelectNote(found);
          pulseHighlight(target as HTMLElement);
        }
      }
    }
  };

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
    // Verify selection is within the reader content container
    if (contentRef.current && !contentRef.current.contains(sel.anchorNode)) {
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
          top: Math.max(10, rect.top - containerRect.top + containerRef.current.scrollTop - 44),
          left: Math.max(70, Math.min(containerRect.width - 70, rect.left - containerRect.left + rect.width / 2)),
        },
      });
    } catch {
      setSelectionData(null);
    }
  };

  const handleCreateNoteFromSelection = () => {
    if (!selectionData) return;
    const textToSave = selectionData.text;
    onRequestCreateNote({
      documentId: docItem.id,
      pageNumber: currentChapter,
      selectedText: textToSave,
      boundingBox: { x1: 0, y1: 0, x2: 0, y2: 0 },
    });
    window.getSelection()?.removeAllRanges();
    setSelectionData(null);
  };

  // Dismiss selection popup if user clicks elsewhere outside the button
  useEffect(() => {
    if (!selectionData) return;
    const handleDocumentMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.epub-floating-note-btn')) {
        return;
      }
      setSelectionData(null);
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, [selectionData]);

  const currentChapterTitle = useMemo(() => {
    if (!chapters.length) return `Kapitel ${currentChapter}`;
    const found = chapters.find((c) => c.index === currentChapter);
    return found ? found.title : `Kapitel ${currentChapter}`;
  }, [chapters, currentChapter]);

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
      {/* Scoped CSS for in-text highlights and pulse animations */}
      <style>{`
        mark.epub-note-highlight {
          background-color: ${themeStyle.highlightBg};
          border-bottom: 2px solid ${themeStyle.highlightBorder};
          color: inherit;
          border-radius: 2px;
          padding: 1px 3px;
          cursor: pointer;
          transition: background-color 0.2s ease, box-shadow 0.2s ease;
          position: relative;
        }
        mark.epub-note-highlight:hover {
          background-color: ${themeStyle.highlightHover};
          box-shadow: 0 0 6px ${themeStyle.highlightRing};
        }
        mark.epub-note-highlight.epub-highlight-active {
          background-color: ${themeStyle.highlightActiveBg} !important;
          box-shadow: 0 0 0 4px ${themeStyle.highlightRing} !important;
          animation: epub-pulse-glow 2s ease-in-out;
        }
        @keyframes epub-pulse-glow {
          0% { transform: scale(1); box-shadow: 0 0 0 0 ${themeStyle.highlightRing}; }
          35% { transform: scale(1.025); box-shadow: 0 0 0 6px ${themeStyle.highlightRing}; }
          70% { transform: scale(1.01); box-shadow: 0 0 0 3px ${themeStyle.highlightRing}; }
          100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>

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
            style={{
              position: 'absolute',
              top: `${selectionData.rect.top}px`,
              left: `${selectionData.rect.left}px`,
              transform: 'translateX(-50%)',
              zIndex: 40,
            }}
            className="epub-floating-note-btn animate-in fade-in zoom-in-95 duration-100"
          >
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCreateNoteFromSelection();
              }}
              className="flex items-center gap-1.5 bg-slate-900/95 hover:bg-indigo-600 text-white border border-indigo-500/50 rounded-lg px-3 py-1.5 shadow-xl backdrop-blur-sm cursor-pointer transition-all text-xs font-medium"
            >
              <Highlighter size={13} className="text-amber-400" />
              <span>Lesezettel erstellen</span>
            </button>
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
            <div className="mb-6 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs flex flex-wrap items-center justify-between gap-2 text-amber-300">
              <div className="flex items-center gap-2 font-medium">
                <Highlighter size={14} className="text-amber-400" />
                <span>
                  {currentChapterNotes.length} {currentChapterNotes.length === 1 ? 'Lesezettel' : 'Lesezettel'} in diesem Kapitel
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {currentChapterNotes.map((n, idx) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      scrollToNote(n.id);
                      onSelectNote(n);
                    }}
                    className="flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/35 px-2 py-1 rounded-md text-[11px] text-amber-200 transition-colors"
                    title={`Zu Zitat springen: "${n.selectedText || n.noteMarkdown}"`}
                  >
                    <span className="font-mono text-[10px] text-amber-400/80">#{idx + 1}</span>
                    <span className="truncate max-w-[140px]">"{n.selectedText || n.noteMarkdown}"</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* HTML Render Container with in-text highlights */}
          <div
            ref={contentRef}
            onClick={handleContentClick}
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
