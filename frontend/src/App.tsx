import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  Tag as TagIcon,
  BookMarked,
  Search,
  RefreshCw,
  Sun,
  Moon,
  Plus,
  Trash2,
  Edit3,
  ChevronRight,
  ChevronDown,
  Library,
  Sparkles,
  X,
  ExternalLink,
  Layers,
  Settings,
  CheckCircle2,
  Clock,
  CircleDashed,
  Columns2,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  GripVertical,
  ListTree,
  Loader2,
} from 'lucide-react';
import { api } from './api';
import {
  AppSettings,
  BoundingBox,
  DocumentItem,
  ReadingNote,
  ReadingStatus,
  SearchResultGroup,
  Tag,
  TocItem,
  TreeNode,
  UpdateReadingProgressPayload,
} from './types';
import {
  PdfViewer,
  TocTreeNode,
  countTocItems,
  findActiveTocPage,
} from './components/PdfViewer';
import { NoteModal } from './components/NoteModal';
import { DocumentCover } from './components/DocumentCover';
import { SettingsModal } from './components/SettingsModal';

const SETTINGS_STORAGE_KEY = 'pdforever.settings';
const DARK_MODE_STORAGE_KEY = 'pdforever.darkMode';
const SIDEBAR_WIDTH_STORAGE_KEY = 'pdforever.sidebarWidth';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'pdforever.sidebarCollapsed';
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 640;
const DEFAULT_SIDEBAR_WIDTH = 320;

const DEFAULT_SETTINGS: AppSettings = {
  showCovers: true,
  coverLayout: 'left',
  defaultViewMode: 'continuous',
  defaultInspectorOpen: true,
};

function loadInitialSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadInitialDarkMode(): boolean {
  try {
    const raw = localStorage.getItem(DARK_MODE_STORAGE_KEY);
    return raw !== null ? JSON.parse(raw) : true;
  } catch {
    return true;
  }
}

function loadInitialSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_SIDEBAR_WIDTH;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return DEFAULT_SIDEBAR_WIDTH;
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, parsed));
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function loadInitialSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    return raw !== null ? Boolean(JSON.parse(raw)) : false;
  } catch {
    return false;
  }
}

const TAG_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
];

export const App: React.FC = () => {
  const [darkMode, setDarkMode] = useState<boolean>(loadInitialDarkMode);
  const [settings, setSettings] = useState<AppSettings>(loadInitialSettings);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [coverCacheVersion, setCoverCacheVersion] = useState<number>(0);
  const [sidebarTab, setSidebarTab] = useState<'folders' | 'outline' | 'tags' | 'notes'>('folders');
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadInitialSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(loadInitialSidebarCollapsed);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);

  // Data state
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [recentDocuments, setRecentDocuments] = useState<DocumentItem[]>([]);
  const [allDocumentsList, setAllDocumentsList] = useState<DocumentItem[]>([]);
  const [totalDocs, setTotalDocs] = useState<number>(0);
  const [tags, setTags] = useState<Tag[]>([]);
  const [globalNotes, setGlobalNotes] = useState<ReadingNote[]>([]);
  const [docNotes, setDocNotes] = useState<ReadingNote[]>([]);
  const [docOutline, setDocOutline] = useState<TocItem[]>([]);
  const [outlineLoading, setOutlineLoading] = useState<boolean>(false);
  const [tocFilter, setTocFilter] = useState<string>('');
  const [activeViewerPage, setActiveViewerPage] = useState<number>(1);

  // Filter & Selection state
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>('');
  const [selectedTagName, setSelectedTagName] = useState<string>('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('');
  const [activeDoc, setActiveDoc] = useState<DocumentItem | null>(null);
  const [targetJump, setTargetJump] = useState<{
    page: number;
    noteId?: string;
    timestamp: number;
  } | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);

  // Split-View (Secondary Reader Pane) state
  const [splitViewOpen, setSplitViewOpen] = useState<boolean>(false);
  const [secondaryDoc, setSecondaryDoc] = useState<DocumentItem | null>(null);
  const [secondaryDocNotes, setSecondaryDocNotes] = useState<ReadingNote[]>([]);
  const [secondaryTargetJump, setSecondaryTargetJump] = useState<{
    page: number;
    noteId?: string;
    timestamp: number;
  } | null>(null);

  // Instant Lucene Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResultGroup[]>([]);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searching, setSearching] = useState<boolean>(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  // Global Notes Search state
  const [noteSearchQuery, setNoteSearchQuery] = useState<string>('');

  // New Tag Form state
  const [newTagName, setNewTagName] = useState<string>('');
  const [newTagColor, setNewTagColor] = useState<string>(TAG_COLORS[0]);

  // Note Modal state
  const [noteModalOpen, setNoteModalOpen] = useState<boolean>(false);
  const [pendingSelection, setPendingSelection] = useState<{
    documentId?: string;
    pageNumber: number;
    selectedText: string;
    boundingBox: BoundingBox;
  }>({
    pageNumber: 1,
    selectedText: '',
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.15 },
  });
  const [editingNote, setEditingNote] = useState<ReadingNote | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);

  // Theme sync
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem(DARK_MODE_STORAGE_KEY, JSON.stringify(darkMode));
    } catch {
      // ignore storage errors
    }
  }, [darkMode]);

  // Settings persistence
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore storage errors
    }
  }, [settings]);

  // Sidebar width & collapse persistence
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // ignore storage errors
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, JSON.stringify(sidebarCollapsed));
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed]);

  // Global mousemove / mouseup listeners while dragging the left sidebar resizer
  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (e.clientX < 90) {
        setSidebarCollapsed(true);
        return;
      }
      setSidebarCollapsed(false);
      const clamped = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  const loadLibraryData = useCallback(async () => {
    try {
      const [treeData, tagsData, docsPage, recentDocs, allDocsPage, allNotes] = await Promise.all([
        api.getTree(),
        api.getTags(),
        api.getDocuments({
          path: selectedFolderPath,
          tag: selectedTagName,
          status: selectedStatusFilter,
          page: 0,
          size: 100,
        }),
        api.getRecentDocuments(6),
        api.getDocuments({ page: 0, size: 200 }),
        api.searchNotes(noteSearchQuery),
      ]);
      setTree(treeData);
      setTags(tagsData);
      setDocuments(docsPage.content);
      setRecentDocuments(recentDocs);
      setAllDocumentsList(allDocsPage.content);
      setTotalDocs(allDocsPage.totalElements);
      setGlobalNotes(allNotes);
    } catch (err) {
      console.error('Error loading library data:', err);
    }
  }, [selectedFolderPath, selectedTagName, selectedStatusFilter, noteSearchQuery]);

  useEffect(() => {
    loadLibraryData();
  }, [loadLibraryData]);

  // Load notes and TOC outline when active document changes
  useEffect(() => {
    if (!activeDoc) {
      setDocNotes([]);
      setDocOutline([]);
      setOutlineLoading(false);
      setTocFilter('');
      return;
    }
    let cancelled = false;
    setOutlineLoading(true);
    setTocFilter('');
    setActiveViewerPage(activeDoc.lastReadPage || 1);

    api
      .getDocumentNotes(activeDoc.id)
      .then((notes) => {
        if (!cancelled) setDocNotes(notes);
      })
      .catch((err) => console.error('Failed to load document notes:', err));

    api
      .getDocumentOutline(activeDoc.id)
      .then((items) => {
        if (!cancelled) setDocOutline(items || []);
      })
      .catch(() => {
        if (!cancelled) setDocOutline([]);
      })
      .finally(() => {
        if (!cancelled) setOutlineLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeDoc?.id]);

  const totalTocCount = useMemo(() => countTocItems(docOutline), [docOutline]);
  const activeTocPage = useMemo(
    () => findActiveTocPage(docOutline, activeViewerPage),
    [docOutline, activeViewerPage]
  );

  // Load notes when secondary document in Split-View changes
  useEffect(() => {
    if (!secondaryDoc || !splitViewOpen) {
      setSecondaryDocNotes([]);
      return;
    }
    api
      .getDocumentNotes(secondaryDoc.id)
      .then(setSecondaryDocNotes)
      .catch((err) => console.error('Failed to load secondary document notes:', err));
  }, [secondaryDoc?.id, splitViewOpen]);

  // Instant Lucene Search debounce
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .searchLucene(q)
        .then((res) => {
          setSearchResults(res);
          setSearchOpen(true);
        })
        .catch((err) => console.error('Search error:', err))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close search popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpenDocument = useCallback(
    async (docId: string, explicitPage?: number, noteId?: string) => {
      try {
        const doc = await api.getDocument(docId);
        const targetPage = explicitPage ?? (doc.lastReadPage && doc.lastReadPage > 1 ? doc.lastReadPage : 1);
        setActiveDoc(doc);
        setTargetJump({ page: targetPage, noteId, timestamp: Date.now() });
        setSearchOpen(false);
      } catch (err) {
        console.error('Failed to open document:', err);
      }
    },
    []
  );

  const handleOpenInSplitView = useCallback(
    async (docId: string, explicitPage?: number) => {
      try {
        const doc = await api.getDocument(docId);
        const targetPage = explicitPage ?? (doc.lastReadPage && doc.lastReadPage > 1 ? doc.lastReadPage : 1);
        if (!activeDoc) {
          setActiveDoc(doc);
          setTargetJump({ page: targetPage, timestamp: Date.now() });
        } else {
          setSecondaryDoc(doc);
          setSecondaryTargetJump({ page: targetPage, timestamp: Date.now() });
          setSplitViewOpen(true);
        }
      } catch (err) {
        console.error('Failed to open document in split view:', err);
      }
    },
    [activeDoc]
  );

  const handleToggleSplitView = useCallback(() => {
    setSplitViewOpen((prev) => {
      const next = !prev;
      if (next && !secondaryDoc && activeDoc) {
        setSecondaryDoc(activeDoc);
        setSecondaryTargetJump({ page: activeDoc.lastReadPage || 1, timestamp: Date.now() });
      }
      return next;
    });
  }, [activeDoc, secondaryDoc]);

  const handleUpdateReadingProgress = useCallback(
    async (docId: string, payload: UpdateReadingProgressPayload) => {
      try {
        const updated = await api.updateReadingProgress(docId, payload);
        setActiveDoc((prev) => (prev && prev.id === docId ? updated : prev));
        setSecondaryDoc((prev) => (prev && prev.id === docId ? updated : prev));
        setDocuments((prev) => prev.map((d) => (d.id === docId ? updated : d)));
        setAllDocumentsList((prev) => prev.map((d) => (d.id === docId ? updated : d)));
        api
          .getRecentDocuments(6)
          .then(setRecentDocuments)
          .catch(() => {});
      } catch (err) {
        console.error('Failed to update reading progress:', err);
      }
    },
    []
  );

  const handleSyncLibrary = async () => {
    setSyncing(true);
    try {
      const updatedTree = await api.reconcileTree();
      setTree(updatedTree);
      await loadLibraryData();
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    const created = await api.createTag(newTagName.trim(), newTagColor);
    setTags((prev) => [...prev.filter((t) => t.id !== created.id), created]);
    setNewTagName('');
  };

  const handleDeleteTag = async (tagId: number) => {
    await api.deleteTag(tagId);
    setTags((prev) => prev.filter((t) => t.id !== tagId));
    if (activeDoc) {
      const refreshed = await api.getDocument(activeDoc.id);
      setActiveDoc(refreshed);
    }
    loadLibraryData();
  };

  const handleToggleDocTag = async (tag: Tag) => {
    if (!activeDoc) return;
    const hasTag = activeDoc.tags.some((t) => t.id === tag.id);
    const updatedDoc = hasTag
      ? await api.detachTag(activeDoc.id, tag.id)
      : await api.attachTag(activeDoc.id, tag.id);
    setActiveDoc(updatedDoc);
    loadLibraryData();
  };

  const handleSaveNote = async (data: {
    pageNumber: number;
    selectedText: string;
    noteMarkdown: string;
    boundingBox: BoundingBox;
  }) => {
    const targetDocId = pendingSelection.documentId || activeDoc?.id;
    if (!targetDocId) return;

    if (editingNote) {
      await api.updateNote(editingNote.id, {
        selectedText: data.selectedText,
        noteMarkdown: data.noteMarkdown,
        boundingBox: data.boundingBox,
      });
    } else {
      await api.createNote({
        documentId: targetDocId,
        pageNumber: data.pageNumber,
        selectedText: data.selectedText,
        noteMarkdown: data.noteMarkdown,
        boundingBox: data.boundingBox,
      });
    }

    const promises: Promise<unknown>[] = [api.searchNotes(noteSearchQuery).then(setGlobalNotes)];
    if (activeDoc) {
      promises.push(api.getDocumentNotes(activeDoc.id).then(setDocNotes));
    }
    if (secondaryDoc && splitViewOpen) {
      promises.push(api.getDocumentNotes(secondaryDoc.id).then(setSecondaryDocNotes));
    }
    await Promise.all(promises);
    setEditingNote(null);
  };

  const handleDeleteNote = async (noteId: string) => {
    await api.deleteNote(noteId);
    if (activeDoc) {
      setDocNotes((prev) => prev.filter((n) => n.id !== noteId));
    }
    if (secondaryDoc) {
      setSecondaryDocNotes((prev) => prev.filter((n) => n.id !== noteId));
    }
    setGlobalNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const renderStatusBadge = (doc: DocumentItem) => {
    const status: ReadingStatus = doc.readingStatus || 'UNREAD';
    const pct = Math.min(
      100,
      Math.max(0, Math.round(((doc.lastReadPage || 1) / Math.max(1, doc.pageCount || 1)) * 100))
    );

    if (status === 'COMPLETED') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-3 h-3" />
          Gelesen
        </span>
      );
    }
    if (status === 'READING') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Clock className="w-3 h-3" />
          S. {doc.lastReadPage || 1}/{doc.pageCount} ({pct}%)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
        <CircleDashed className="w-3 h-3" />
        Ungelesen
      </span>
    );
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Bar */}
      <header className="h-14 shrink-0 px-4 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 z-30">
        {/* Brand & Left Sidebar Toggle */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
            title={
              sidebarCollapsed
                ? 'Linke Seitenleiste einblenden'
                : 'Linke Seitenleiste ausblenden'
            }
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>

          <button
            onClick={() => {
              setActiveDoc(null);
              setSplitViewOpen(false);
            }}
            className="flex items-center gap-2.5 text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-sm">
              <Library className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold tracking-tight text-base text-slate-900 dark:text-white group-hover:text-blue-500 transition">
                PDForever
              </span>
              <span className="hidden sm:inline-block ml-2 text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono">
                In-Place Library
              </span>
            </div>
          </button>
        </div>

        {/* Instant Lucene Search Bar with Auto-Suggest Highlighting */}
        <div ref={searchBoxRef} className="relative flex-1 max-w-2xl">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => {
                if (searchQuery.trim()) setSearchOpen(true);
              }}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search fulltext across all PDF pages (Lucene BM25 + UnifiedHighlighter)…"
              className="w-full pl-10 pr-9 py-1.5 rounded-full border border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/80 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-900 transition"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setSearchOpen(false);
                }}
                className="absolute right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Instant Search Dropdown Results */}
          {searchOpen && searchQuery.trim() && (
            <div className="absolute left-0 right-0 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-50 divide-y divide-slate-100 dark:divide-slate-800">
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  {searching
                    ? 'Searching Lucene page index…'
                    : `${searchResults.reduce((acc, g) => acc + g.matches.length, 0)} page matches across ${searchResults.length} documents`}
                </span>
                <span>Click any passage to jump to page</span>
              </div>

              {searchResults.length === 0 && !searching ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No fulltext matches found for "{searchQuery}".
                </div>
              ) : (
                searchResults.map((group) => (
                  <div key={group.docId} className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleOpenDocument(group.docId, group.matches[0]?.pageNumber || 1)}
                        className="font-semibold text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5 text-left"
                      >
                        <FileText className="w-4 h-4 shrink-0" />
                        <span className="truncate">{group.title}</span>
                      </button>
                      <span className="text-[11px] font-mono text-slate-400 truncate max-w-xs">
                        {group.relPath}
                      </span>
                    </div>

                    <div className="space-y-1.5 pl-5">
                      {group.matches.map((m) => (
                        <button
                          key={`${group.docId}-p${m.pageNumber}`}
                          onClick={() => handleOpenDocument(group.docId, m.pageNumber)}
                          className="w-full text-left p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/80 transition flex items-start gap-2.5 group"
                        >
                          <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono text-[11px] font-medium">
                            p. {m.pageNumber}
                          </span>
                          <p
                            className="search-snippet text-xs text-slate-700 dark:text-slate-300 line-clamp-2 leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: m.snippetHtml }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {activeDoc && (
            <button
              onClick={() => {
                setActiveDoc(null);
                setSplitViewOpen(false);
              }}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Layers className="w-3.5 h-3.5" />
              All Documents
            </button>
          )}

          <button
            onClick={handleSyncLibrary}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
            title="Reconcile filesystem with database & Lucene index"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-blue-500' : ''}`} />
            <span className="hidden md:inline">{syncing ? 'Syncing…' : 'Sync Storage'}</span>
          </button>

          <button
            onClick={() => setDarkMode((d) => !d)}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            title="Toggle Dark/Light Theme"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition"
            title="Einstellungen öffnen"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Einstellungen</span>
          </button>
        </div>
      </header>

      {/* 3-Panel Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar: 4 Tabs (Folders, Gliederung/TOC, Tags, Notes) */}
        {!sidebarCollapsed && (
          <aside
            style={{ width: `${sidebarWidth}px` }}
            className="shrink-0 flex flex-col bg-white dark:bg-slate-900/90 overflow-hidden"
          >
            {/* Sidebar Navigation Tabs */}
            <div className="grid grid-cols-4 border-b border-slate-200 dark:border-slate-800 p-1 gap-1 bg-slate-100/60 dark:bg-slate-950/50">
              <button
                onClick={() => setSidebarTab('folders')}
                className={`flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-medium transition truncate ${
                  sidebarTab === 'folders'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Ordner & Dateien"
              >
                <Folder className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Folders</span>
              </button>
              <button
                onClick={() => setSidebarTab('outline')}
                className={`flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-medium transition truncate ${
                  sidebarTab === 'outline'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Inhaltsverzeichnis / PDF-Bookmarks (Gliederung)"
              >
                <ListTree className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Gliederung{totalTocCount > 0 ? ` (${totalTocCount})` : ''}
                </span>
              </button>
              <button
                onClick={() => setSidebarTab('tags')}
                className={`flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-medium transition truncate ${
                  sidebarTab === 'tags'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Tags"
              >
                <TagIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Tags ({tags.length})</span>
              </button>
              <button
                onClick={() => setSidebarTab('notes')}
                className={`flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-medium transition truncate ${
                  sidebarTab === 'notes'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Lesezettel / Notizen"
              >
                <BookMarked className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Notes ({globalNotes.length})</span>
              </button>
            </div>

          {/* Tab 1: Directory Tree */}
          {sidebarTab === 'folders' && (
            <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
              <button
                onClick={() => {
                  setSelectedFolderPath('');
                  setSelectedTagName('');
                  setSelectedStatusFilter('');
                  setActiveDoc(null);
                  setSplitViewOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                  selectedFolderPath === '' && !activeDoc
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Library className="w-3.5 h-3.5 text-blue-500" />
                  All Storage Files
                </span>
                <span className="text-[11px] font-mono text-slate-400">{totalDocs}</span>
              </button>

              {tree &&
                tree.children.map((node) => (
                  <DirectoryTreeItem
                    key={node.path}
                    node={node}
                    level={0}
                    selectedFolderPath={selectedFolderPath}
                    activeDocId={activeDoc?.id || null}
                    secondaryDocId={splitViewOpen ? secondaryDoc?.id || null : null}
                    onSelectFolder={(folderPath) => {
                      setSelectedFolderPath(folderPath);
                      setActiveDoc(null);
                      setSplitViewOpen(false);
                    }}
                    onSelectFile={(docId) => handleOpenDocument(docId)}
                    onOpenInSplitView={(docId) => handleOpenInSplitView(docId)}
                  />
                ))}
            </div>
          )}

          {/* Tab 2: Document Outline / Table of Contents (Gliederung) */}
          {sidebarTab === 'outline' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {!activeDoc ? (
                <div className="text-center py-12 px-4 space-y-2">
                  <ListTree className="w-7 h-7 text-slate-400 mx-auto stroke-1" />
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Kein Dokument geöffnet
                  </p>
                  <p className="text-xs text-slate-500">
                    Öffnen Sie ein PDF-Dokument, um dessen Inhaltsverzeichnis (PDF-Bookmarks) hier anzuzeigen.
                  </p>
                </div>
              ) : (
                <>
                  <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <span
                        className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate"
                        title={activeDoc.fileName}
                      >
                        {activeDoc.fileName}
                      </span>
                      {totalTocCount > 0 && (
                        <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                          {totalTocCount}
                        </span>
                      )}
                    </div>

                    {totalTocCount > 4 && (
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                        <input
                          type="text"
                          value={tocFilter}
                          onChange={(e) => setTocFilter(e.target.value)}
                          placeholder="Kapitel filtern…"
                          className="w-full pl-8 pr-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                    {outlineLoading ? (
                      <div className="flex items-center justify-center py-10 text-xs text-slate-400 gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        Lese PDF-Gliederung…
                      </div>
                    ) : docOutline.length === 0 ? (
                      <div className="text-center py-10 px-3 space-y-1.5">
                        <ListTree className="w-6 h-6 text-slate-400 mx-auto stroke-1" />
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          Keine PDF-Bookmarks vorhanden
                        </p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Dieses PDF enthält kein eingebettetes Inhaltsverzeichnis (PDDocumentOutline).
                        </p>
                      </div>
                    ) : (
                      docOutline.map((item, idx) => (
                        <TocTreeNode
                          key={`${item.title}-${idx}`}
                          item={item}
                          level={0}
                          filterQuery={tocFilter}
                          activeTocPage={activeTocPage}
                          onSelectPage={(page) =>
                            setTargetJump({ page, timestamp: Date.now() })
                          }
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tab 3: Tag Browser */}
          {sidebarTab === 'tags' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <form
                onSubmit={handleCreateTag}
                className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5"
              >
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Create New Tag
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="e.g. Ethnology, Recipes…"
                    className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  {TAG_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setNewTagColor(hex)}
                      style={{ backgroundColor: hex }}
                      className={`w-4 h-4 rounded-full transition ${
                        newTagColor === hex ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'opacity-70'
                      }`}
                    />
                  ))}
                </div>
              </form>

              <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
                {selectedTagName && (
                  <button
                    onClick={() => setSelectedTagName('')}
                    className="w-full text-left px-2.5 py-1.5 text-xs text-blue-500 hover:underline"
                  >
                    ← Clear tag filter ({selectedTagName})
                  </button>
                )}

                {tags.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-8">
                    No tags created yet. Create one above to organize your PDFs.
                  </p>
                ) : (
                  tags.map((tag) => (
                    <div
                      key={tag.id}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition ${
                        selectedTagName === tag.name
                          ? 'bg-blue-500/10 font-semibold text-blue-600 dark:text-blue-400'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <button
                        onClick={() => {
                          setSelectedTagName(tag.name === selectedTagName ? '' : tag.name);
                          setActiveDoc(null);
                          setSplitViewOpen(false);
                        }}
                        className="flex items-center gap-2 flex-1 text-left truncate"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: tag.colorHex }}
                        />
                        <span className="truncate">{tag.name}</span>
                      </button>
                      <button
                        onClick={() => handleDeleteTag(tag.id)}
                        className="p-1 text-slate-400 hover:text-red-500"
                        title="Delete tag"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Tab 3: Global Reading Notes Search */}
          {sidebarTab === 'notes' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-2.5 border-b border-slate-200 dark:border-slate-800">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={noteSearchQuery}
                    onChange={(e) => setNoteSearchQuery(e.target.value)}
                    placeholder="Filter reading notes & quotes…"
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                {globalNotes.length === 0 ? (
                  <div className="text-center py-10 px-4 space-y-2">
                    <BookMarked className="w-7 h-7 text-slate-400 mx-auto stroke-1" />
                    <p className="text-xs text-slate-500">
                      No reading notes found. Open any PDF and select text on a page to create a Lesezettel!
                    </p>
                  </div>
                ) : (
                  globalNotes.map((note) => (
                    <div
                      key={note.id}
                      onClick={() => handleOpenDocument(note.documentId, note.pageNumber, note.id)}
                      className="cursor-pointer rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-800/40 hover:border-amber-500/60 transition space-y-1.5 group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 truncate">
                          {note.documentTitle}
                        </span>
                        <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-[10px] font-semibold">
                          p. {note.pageNumber}
                        </span>
                      </div>

                      {note.selectedText && (
                        <blockquote className="border-l-2 border-amber-400 pl-2 text-[11px] italic text-slate-500 dark:text-slate-400 line-clamp-2">
                          "{note.selectedText}"
                        </blockquote>
                      )}

                      <p className="text-xs text-slate-800 dark:text-slate-200 line-clamp-3 whitespace-pre-line">
                        {note.noteMarkdown}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Sidebar Footer: Quick Access to Settings (Einstellungen) */}
          <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <span className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                Einstellungen
              </span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  settings.showCovers
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                }`}
              >
                Cover: {settings.showCovers ? 'Ein' : 'Aus'}
              </span>
            </button>
          </div>
          </aside>
        )}

        {/* Horizontal Resize Splitter Handle between Left Sidebar and Main Content Area */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Breite der linken Seitenleiste anpassen"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizingSidebar(true);
          }}
          onDoubleClick={() => {
            setSidebarCollapsed(false);
            setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
          }}
          title="Ziehen zum Verkleinern/Vergrößern • Doppelklick für Standardbreite (320px)"
          className={`group relative w-1.5 shrink-0 cursor-col-resize flex items-center justify-center transition-colors z-20 ${
            isResizingSidebar
              ? 'bg-blue-600'
              : 'bg-slate-200/80 dark:bg-slate-800/90 hover:bg-blue-500/60 dark:hover:bg-blue-500/60'
          }`}
        >
          {/* Invisible wider hit-area for effortless grabbing */}
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
          <div
            className={`pointer-events-none flex items-center justify-center w-3.5 h-8 rounded-full border shadow-xs transition-opacity ${
              isResizingSidebar
                ? 'opacity-100 bg-blue-600 border-blue-400 text-white'
                : 'opacity-0 group-hover:opacity-100 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-300'
            }`}
          >
            <GripVertical className="w-3 h-3" />
          </div>
        </div>

        {/* Main Content Area: Either PDF.js Reader (+ Optional Split-View & Inspector) OR Document Explorer */}
        <main className="flex-1 flex min-w-0 overflow-hidden">
          {activeDoc ? (
            <>
              {/* Reader Area: Single or Side-by-Side Split-View */}
              <div className="flex-1 flex min-w-0 h-full divide-x divide-slate-200 dark:divide-slate-800">
                {/* Primary PDF Viewer */}
                <div className="flex-1 min-w-0 h-full">
                  <PdfViewer
                    document={activeDoc}
                    notes={docNotes}
                    targetJump={targetJump}
                    inspectorOpen={inspectorOpen}
                    defaultViewMode={settings.defaultViewMode}
                    isSplitView={splitViewOpen}
                    isSecondaryPane={false}
                    onToggleInspector={() => setInspectorOpen((o) => !o)}
                    onToggleSplitView={handleToggleSplitView}
                    onUpdateProgress={handleUpdateReadingProgress}
                    onPageChange={setActiveViewerPage}
                    onRequestCreateNote={(sel) => {
                      setEditingNote(null);
                      setPendingSelection(sel);
                      setNoteModalOpen(true);
                    }}
                    onSelectNote={(note) => {
                      setInspectorOpen(true);
                      setTargetJump({
                        page: note.pageNumber,
                        noteId: note.id,
                        timestamp: Date.now(),
                      });
                    }}
                  />
                </div>

                {/* Secondary PDF Viewer (Split-View Mode) */}
                {splitViewOpen && secondaryDoc && (
                  <div className="flex-1 min-w-0 h-full">
                    <PdfViewer
                      document={secondaryDoc}
                      notes={secondaryDocNotes}
                      targetJump={secondaryTargetJump}
                      inspectorOpen={inspectorOpen}
                      defaultViewMode={settings.defaultViewMode}
                      isSplitView={true}
                      isSecondaryPane={true}
                      availableDocuments={allDocumentsList.length > 0 ? allDocumentsList : documents}
                      onCloseSecondaryPane={() => setSplitViewOpen(false)}
                      onChangeSecondaryDocument={(newDocId) => handleOpenInSplitView(newDocId)}
                      onUpdateProgress={handleUpdateReadingProgress}
                      onRequestCreateNote={(sel) => {
                        setEditingNote(null);
                        setPendingSelection(sel);
                        setNoteModalOpen(true);
                      }}
                      onSelectNote={(note) => {
                        setInspectorOpen(true);
                        setSecondaryTargetJump({
                          page: note.pageNumber,
                          noteId: note.id,
                          timestamp: Date.now(),
                        });
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Right Split-Pane Inspector: Reading Status, Document Tags & Reading Notes (Lesezettel) */}
              {inspectorOpen && (
                <aside className="w-80 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full overflow-hidden">
                  {/* Reading Progress & Status Section */}
                  <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-blue-500" />
                        Lesefortschritt & Status
                      </h4>
                      <span className="text-[11px] font-mono text-slate-500">
                        S. {activeDoc.lastReadPage || 1} / {activeDoc.pageCount}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'UNREAD', label: 'Ungelesen', icon: CircleDashed },
                          { id: 'READING', label: 'Am Lesen', icon: Clock },
                          { id: 'COMPLETED', label: 'Gelesen', icon: CheckCircle2 },
                        ] as const
                      ).map((st) => {
                        const isCurrent = (activeDoc.readingStatus || 'UNREAD') === st.id;
                        const Icon = st.icon;
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() =>
                              handleUpdateReadingProgress(activeDoc.id, {
                                readingStatus: st.id,
                              })
                            }
                            className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-medium border transition ${
                              isCurrent
                                ? st.id === 'COMPLETED'
                                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : st.id === 'READING'
                                  ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                  : 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                                : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            <Icon className="w-3 h-3 shrink-0" />
                            <span className="truncate">{st.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Document Tags Section */}
                  <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <TagIcon className="w-3.5 h-3.5" />
                        Document Tags
                      </h4>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.length === 0 ? (
                        <span className="text-xs text-slate-400">
                          Create tags in the left Tags tab to assign them.
                        </span>
                      ) : (
                        tags.map((tag) => {
                          const active = activeDoc.tags.some((t) => t.id === tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => handleToggleDocTag(tag)}
                              style={{
                                borderColor: tag.colorHex,
                                backgroundColor: active ? tag.colorHex : 'transparent',
                                color: active ? '#ffffff' : undefined,
                              }}
                              className="px-2.5 py-0.5 rounded-full text-xs font-medium border transition hover:scale-105"
                            >
                              {tag.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Document Reading Notes List */}
                  <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <BookMarked className="w-3.5 h-3.5 text-amber-500" />
                      Reading Notes ({docNotes.length})
                    </h4>
                    <button
                      onClick={() => {
                        setEditingNote(null);
                        setPendingSelection({
                          documentId: activeDoc.id,
                          pageNumber: targetJump?.page || activeDoc.lastReadPage || 1,
                          selectedText: '',
                          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.16 },
                        });
                        setNoteModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New Note
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {docNotes.length === 0 ? (
                      <div className="text-center py-12 px-4 space-y-2">
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          Select any text directly on the PDF page to pop up{' '}
                          <span className="font-semibold text-amber-500">Add Reading Note</span> with automatic normalized coordinates.
                        </p>
                      </div>
                    ) : (
                      docNotes.map((note) => (
                        <div
                          key={note.id}
                          onClick={() =>
                            setTargetJump({
                              page: note.pageNumber,
                              noteId: note.id,
                              timestamp: Date.now(),
                            })
                          }
                          className="cursor-pointer rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/70 dark:bg-slate-800/50 hover:border-amber-500/70 transition space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-xs font-semibold">
                              Page {note.pageNumber}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingNote(note);
                                  setNoteModalOpen(true);
                                }}
                                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                title="Edit Note"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteNote(note.id);
                                }}
                                className="p-1 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-500"
                                title="Delete Note"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {note.selectedText && (
                            <blockquote className="border-l-2 border-amber-400 pl-2.5 text-xs italic text-slate-600 dark:text-slate-400">
                              "{note.selectedText}"
                            </blockquote>
                          )}

                          <div className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed">
                            {note.noteMarkdown}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </aside>
              )}
            </>
          ) : (
            /* Document Explorer Grid/List View */
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Continue Reading ("Weiterlesen / Zuletzt gelesen") Shelf */}
              {!selectedFolderPath && !selectedTagName && !selectedStatusFilter && recentDocuments.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-500" />
                      Zuletzt gelesen & Weiterlesen
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {recentDocuments.slice(0, 3).map((doc) => {
                      const pct = Math.min(
                        100,
                        Math.max(
                          0,
                          Math.round(((doc.lastReadPage || 1) / Math.max(1, doc.pageCount || 1)) * 100)
                        )
                      );
                      return (
                        <div
                          key={`recent-${doc.id}`}
                          onClick={() => handleOpenDocument(doc.id, doc.lastReadPage || 1)}
                          className="group cursor-pointer rounded-xl border border-amber-500/30 dark:border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-white to-white dark:from-amber-500/10 dark:via-slate-900 dark:to-slate-900 p-3.5 shadow-xs hover:shadow-md hover:border-amber-500/60 transition flex flex-col justify-between gap-3"
                        >
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition truncate">
                                {doc.fileName}
                              </h3>
                              <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                                {doc.relativePath}
                              </p>
                            </div>
                            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 text-slate-950 font-semibold text-[11px] shadow-xs group-hover:scale-105 transition">
                              <Play className="w-3 h-3 fill-current" />
                              S. {doc.lastReadPage || 1}
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                              <span>
                                Seite {doc.lastReadPage || 1} von {doc.pageCount}
                              </span>
                              <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                                {pct}%
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Library Header & Status Filter Pills */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>
                      {selectedFolderPath
                        ? `Folder: /${selectedFolderPath}`
                        : selectedTagName
                        ? `Tagged: #${selectedTagName}`
                        : 'Personal PDF Library'}
                    </span>
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Showing {documents.length} of {totalDocs} in-place indexed PDF documents
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Reading Status Filter Pills */}
                  <div className="inline-flex rounded-xl p-1 bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    {(
                      [
                        { value: '', label: 'Alle' },
                        { value: 'READING', label: 'Am Lesen' },
                        { value: 'UNREAD', label: 'Ungelesen' },
                        { value: 'COMPLETED', label: 'Gelesen' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.value}
                        onClick={() => setSelectedStatusFilter(tab.value)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                          selectedStatusFilter === tab.value
                            ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {(selectedFolderPath || selectedTagName || selectedStatusFilter) && (
                    <button
                      onClick={() => {
                        setSelectedFolderPath('');
                        setSelectedTagName('');
                        setSelectedStatusFilter('');
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-200/70 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700"
                    >
                      Reset Filters
                    </button>
                  )}
                </div>
              </div>

              {documents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center space-y-3">
                  <FileText className="w-10 h-10 text-slate-400 mx-auto stroke-1" />
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    No PDF documents found in this view
                  </div>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Drop PDF files into the <code className="font-mono">/storage</code> directory. WatchService will automatically debounce and index them in place.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {documents.map((doc) => {
                    const docWithCacheKey =
                      coverCacheVersion > 0
                        ? { ...doc, lastModifiedFs: `${doc.lastModifiedFs}-v${coverCacheVersion}` }
                        : doc;
                    const pct = Math.min(
                      100,
                      Math.max(
                        0,
                        Math.round(((doc.lastReadPage || 1) / Math.max(1, doc.pageCount || 1)) * 100)
                      )
                    );

                    if (settings.showCovers && settings.coverLayout === 'top') {
                      return (
                        <div
                          key={doc.id}
                          onClick={() => handleOpenDocument(doc.id)}
                          className="group cursor-pointer rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs hover:shadow-md hover:border-blue-500/60 transition flex flex-col justify-between"
                        >
                          <DocumentCover
                            document={docWithCacheKey}
                            className="w-full h-56 border-b border-slate-100 dark:border-slate-800 group-hover:scale-[1.01] transition-transform"
                          />
                          <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                            <div className="space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 group-hover:text-blue-500 transition line-clamp-2 break-words">
                                    {doc.fileName}
                                  </h3>
                                  <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                                    {doc.relativePath}
                                  </p>
                                </div>
                                <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-blue-500 shrink-0 mt-0.5" />
                              </div>

                              <div className="flex flex-wrap items-center gap-1 pt-1">
                                {renderStatusBadge(doc)}
                                {doc.tags.map((t) => (
                                  <span
                                    key={t.id}
                                    style={{ backgroundColor: `${t.colorHex}22`, color: t.colorHex }}
                                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                  >
                                    #{t.name}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                              {doc.readingStatus === 'READING' && (
                                <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    className="h-full bg-amber-500 rounded-full"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              )}
                              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                <span className="font-mono">{doc.pageCount} pages</span>
                                <span className="font-mono">
                                  {(doc.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (settings.showCovers) {
                      return (
                        <div
                          key={doc.id}
                          onClick={() => handleOpenDocument(doc.id)}
                          className="group cursor-pointer rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-xs hover:shadow-md hover:border-blue-500/60 transition flex gap-3.5"
                        >
                          <DocumentCover
                            document={docWithCacheKey}
                            className="w-24 sm:w-28 aspect-[3/4] shrink-0 rounded-lg border border-slate-200/80 dark:border-slate-800 shadow-xs group-hover:scale-[1.02] transition-transform"
                          />

                          <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                            <div className="space-y-1.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 group-hover:text-blue-500 transition line-clamp-2 break-words">
                                    {doc.fileName}
                                  </h3>
                                  <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                                    {doc.relativePath}
                                  </p>
                                </div>
                                <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-blue-500 shrink-0 mt-0.5" />
                              </div>

                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                {renderStatusBadge(doc)}
                                {doc.tags.map((t) => (
                                  <span
                                    key={t.id}
                                    style={{ backgroundColor: `${t.colorHex}22`, color: t.colorHex }}
                                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                  >
                                    #{t.name}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                              {doc.readingStatus === 'READING' && (
                                <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    className="h-full bg-amber-500 rounded-full"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              )}
                              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                <span className="font-mono">{doc.pageCount} pages</span>
                                <span className="font-mono">
                                  {(doc.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={doc.id}
                        onClick={() => handleOpenDocument(doc.id)}
                        className="group cursor-pointer rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs hover:shadow-md hover:border-blue-500/60 transition flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 group-hover:text-blue-500 transition line-clamp-2 break-words">
                                {doc.fileName}
                              </h3>
                              <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                                {doc.relativePath}
                              </p>
                            </div>
                            <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-blue-500 shrink-0" />
                          </div>

                          <div className="flex flex-wrap items-center gap-1 pt-1">
                            {renderStatusBadge(doc)}
                            {doc.tags.map((t) => (
                              <span
                                key={t.id}
                                style={{ backgroundColor: `${t.colorHex}22`, color: t.colorHex }}
                                className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                              >
                                #{t.name}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2 pt-2.5 border-t border-slate-100 dark:border-slate-800/80">
                          {doc.readingStatus === 'READING' && (
                            <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="font-mono">{doc.pageCount} pages</span>
                            <span className="font-mono">
                              {(doc.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Reading Note (Lesezettel) Creation / Editing Modal */}
      <NoteModal
        isOpen={noteModalOpen}
        pageNumber={pendingSelection.pageNumber}
        selectedText={pendingSelection.selectedText}
        boundingBox={pendingSelection.boundingBox}
        editingNote={editingNote}
        onClose={() => {
          setNoteModalOpen(false);
          setEditingNote(null);
        }}
        onSave={handleSaveNote}
      />

      {/* Settings (Einstellungen) Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        settings={settings}
        darkMode={darkMode}
        onUpdateSettings={setSettings}
        onToggleDarkMode={setDarkMode}
        onClose={() => setSettingsOpen(false)}
        onCoversCleared={() => setCoverCacheVersion((v) => v + 1)}
      />
    </div>
  );
};

interface DirectoryTreeItemProps {
  node: TreeNode;
  level: number;
  selectedFolderPath: string;
  activeDocId: string | null;
  secondaryDocId: string | null;
  onSelectFolder: (path: string) => void;
  onSelectFile: (docId: string) => void;
  onOpenInSplitView: (docId: string) => void;
}

const DirectoryTreeItem: React.FC<DirectoryTreeItemProps> = ({
  node,
  level,
  selectedFolderPath,
  activeDocId,
  secondaryDocId,
  onSelectFolder,
  onSelectFile,
  onOpenInSplitView,
}) => {
  const [expanded, setExpanded] = useState<boolean>(level < 2);

  if (node.type === 'file') {
    const isSelected = node.documentId !== null && node.documentId === activeDocId;
    const isSecondary = node.documentId !== null && node.documentId === secondaryDocId;
    return (
      <div
        style={{ paddingLeft: `${level * 12 + 10}px` }}
        className={`group w-full flex items-center justify-between pr-1.5 py-1 rounded-lg text-xs transition ${
          isSelected
            ? 'bg-blue-600 text-white font-medium'
            : isSecondary
            ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-medium'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800/70 text-slate-600 dark:text-slate-300'
        }`}
        title={node.path}
      >
        <button
          onClick={() => node.documentId && onSelectFile(node.documentId)}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left py-0.5"
        >
          <FileText className="w-3.5 h-3.5 shrink-0 opacity-75" />
          <span className="truncate">{node.name}</span>
        </button>

        <div className="flex items-center gap-1 shrink-0 ml-1">
          {activeDocId && node.documentId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenInSplitView(node.documentId!);
              }}
              className={`opacity-0 group-hover:opacity-100 p-1 rounded transition ${
                isSelected
                  ? 'hover:bg-blue-500 text-white'
                  : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-indigo-500'
              }`}
              title="Im Split-View rechts öffnen"
            >
              <Columns2 className="w-3 h-3" />
            </button>
          )}
          {node.pageCount !== null && (
            <span
              className={`text-[10px] font-mono ${
                isSelected ? 'text-blue-100' : 'text-slate-400'
              }`}
            >
              {node.pageCount}p
            </span>
          )}
        </div>
      </div>
    );
  }

  const isFolderSelected = selectedFolderPath === node.path;

  return (
    <div>
      <div
        style={{ paddingLeft: `${level * 12 + 6}px` }}
        className={`flex items-center justify-between pr-2 py-1.5 rounded-lg text-xs cursor-pointer transition ${
          isFolderSelected
            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-300'
        }`}
      >
        <div
          onClick={() => {
            setExpanded((e) => !e);
            onSelectFolder(node.path);
          }}
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
          )}
          {expanded ? (
            <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500" />
          ) : (
            <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500" />
          )}
          <span className="truncate">{node.name}</span>
        </div>
      </div>

      {expanded && node.children.length > 0 && (
        <div className="space-y-0.5 mt-0.5">
          {node.children.map((child) => (
            <DirectoryTreeItem
              key={child.path}
              node={child}
              level={level + 1}
              selectedFolderPath={selectedFolderPath}
              activeDocId={activeDocId}
              secondaryDocId={secondaryDocId}
              onSelectFolder={onSelectFolder}
              onSelectFile={onSelectFile}
              onOpenInSplitView={onOpenInSplitView}
            />
          ))}
        </div>
      )}
    </div>
  );
};
