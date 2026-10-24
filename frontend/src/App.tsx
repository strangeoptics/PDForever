import React, { useEffect, useState, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import {
  FileText,
  RefreshCw,
  Sun,
  Moon,
  Library,
  Layers,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { api } from './api';
import {
  AppSettings,
  BoundingBox,
  DocumentFacets,
  DocumentFilterParams,
  DocumentItem,
  ReadingNote,
  ReadingStatus,
  Tag,
  TocItem,
  TreeNode,
  UpdateMetadataPayload,
  UpdateReadingProgressPayload,
} from './types';
import { LeftSidebar } from './components/LeftSidebar';
import { useSidebarResize } from './hooks/useSidebarResize';
import { useDocumentFilters } from './hooks/useDocumentFilters';
import { useUrlState, parseUrlState, ParsedUrlState } from './hooks/useUrlState';
import { useFullscreen } from './hooks/useFullscreen';
import { VirtualizedDocumentGrid } from './components/VirtualizedDocumentGrid';
import { FacetedFilterBar } from './components/FacetedFilterBar';
import { InstantSearchBar } from './components/InstantSearchBar';
import { ContinueReadingShelf } from './components/ContinueReadingShelf';

const ReaderWorkspace = lazy(() =>
  import('./components/ReaderWorkspace').then((m) => ({ default: m.ReaderWorkspace }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const NoteModal = lazy(() =>
  import('./components/NoteModal').then((m) => ({ default: m.NoteModal }))
);

const SETTINGS_STORAGE_KEY = 'pdforever.settings';
const DARK_MODE_STORAGE_KEY = 'pdforever.darkMode';

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

export const App: React.FC = () => {
  const initialUrlState = useRef(parseUrlState()).current;
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const [darkMode, setDarkMode] = useState<boolean>(loadInitialDarkMode);
  const [settings, setSettings] = useState<AppSettings>(loadInitialSettings);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [coverCacheVersion, setCoverCacheVersion] = useState<number>(() => Date.now());
  const [sidebarTab, setSidebarTab] = useState<'folders' | 'outline' | 'tags' | 'notes' | 'rag'>(initialUrlState.tab || 'folders');
  const {
    sidebarWidth,
    sidebarCollapsed,
    isResizingSidebar,
    toggleCollapsed,
    startResizing,
    resetSidebarWidth,
  } = useSidebarResize();

  // Data state
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [recentDocuments, setRecentDocuments] = useState<DocumentItem[]>([]);
  const [allDocumentsList, setAllDocumentsList] = useState<DocumentItem[]>([]);
  const [totalDocs, setTotalDocs] = useState<number>(0);
  const [docPageNumber, setDocPageNumber] = useState<number>(0);
  const [hasMoreDocuments, setHasMoreDocuments] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [globalNotes, setGlobalNotes] = useState<ReadingNote[]>([]);
  const [docNotes, setDocNotes] = useState<ReadingNote[]>([]);
  const [docOutline, setDocOutline] = useState<TocItem[]>([]);
  const [outlineLoading, setOutlineLoading] = useState<boolean>(false);
  const [tocFilter, setTocFilter] = useState<string>('');
  const [activeViewerPage, setActiveViewerPage] = useState<number>(initialUrlState.page || 1);

  // Document Filters & Facets Hook
  const {
    selectedFolderPath,
    setSelectedFolderPath,
    selectedTagName,
    setSelectedTagName,
    selectedStatusFilter,
    setSelectedStatusFilter,
    selectedFormatFilter,
    setSelectedFormatFilter,
    facetsPanelOpen,
    setFacetsPanelOpen,
    minPagesFilter,
    setMinPagesFilter,
    maxPagesFilter,
    setMaxPagesFilter,
    hasNotesFilter,
    setHasNotesFilter,
    noteTopicFilter,
    setNoteTopicFilter,
    datePresetFilter,
    setDatePresetFilter,
    customDateAfter,
    setCustomDateAfter,
    customDateBefore,
    setCustomDateBefore,
    yearFromFilter,
    setYearFromFilter,
    yearToFilter,
    setYearToFilter,
    hasMetadataFilter,
    setHasMetadataFilter,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
    currentFilterParams,
    activeFacetCount,
    resetAllFilters,
    handleToggleTagFacet,
  } = useDocumentFilters({ folder: initialUrlState.folder, tag: initialUrlState.tag, status: initialUrlState.status, format: initialUrlState.format });
  const [facets, setFacets] = useState<DocumentFacets | null>(null);

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

  // Global Notes Search state
  const [noteSearchQuery, setNoteSearchQuery] = useState<string>('');

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

  // Document Metadata Enrichment state
  const [enrichingDoc, setEnrichingDoc] = useState<boolean>(false);

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

  const loadLibraryData = useCallback(async () => {
    try {
      const [treeData, tagsData, docsPage, facetsData, recentDocs, allDocsPage, allNotes] =
        await Promise.all([
          api.getTree(),
          api.getTags(),
          api.getDocuments(currentFilterParams),
          api.getDocumentFacets(selectedFolderPath || undefined),
          api.getRecentDocuments(6),
          api.getDocuments({ page: 0, size: 200 }),
          api.searchNotes(noteSearchQuery),
        ]);
      setTree(treeData);
      setTags(tagsData);
      setDocuments(docsPage.content);
      setDocPageNumber(0);
      setHasMoreDocuments(docsPage.number + 1 < docsPage.totalPages);
      setFacets(facetsData);
      setRecentDocuments(recentDocs);
      setAllDocumentsList(allDocsPage.content);
      setTotalDocs(allDocsPage.totalElements);
      setGlobalNotes(allNotes);
    } catch (err) {
      console.error('Error loading library data:', err);
    }
  }, [currentFilterParams, selectedFolderPath, noteSearchQuery]);

  useEffect(() => {
    loadLibraryData();
  }, [loadLibraryData]);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMoreDocuments) return;
    setIsLoadingMore(true);
    try {
      const nextPage = docPageNumber + 1;
      const res = await api.getDocuments({
        ...currentFilterParams,
        page: nextPage,
      });
      setDocuments((prev) => [...prev, ...res.content]);
      setDocPageNumber(nextPage);
      setHasMoreDocuments(res.number + 1 < res.totalPages);
    } catch (err) {
      console.error("Failed to load more documents:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMoreDocuments, docPageNumber, currentFilterParams]);

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

  const handleOpenDocument = useCallback(
    async (docId: string, explicitPage?: number, noteId?: string) => {
      try {
        const doc = await api.getDocument(docId);
        const targetPage = explicitPage ?? (doc.lastReadPage && doc.lastReadPage > 1 ? doc.lastReadPage : 1);
        setActiveDoc(doc);
        setTargetJump({ page: targetPage, noteId, timestamp: Date.now() });
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

  // Open initial document if URL contains ?doc=...
  const initialOpenedRef = useRef(false);
  useEffect(() => {
    if (initialOpenedRef.current) return;
    initialOpenedRef.current = true;

    if (initialUrlState.docId) {
      handleOpenDocument(
        initialUrlState.docId,
        initialUrlState.page || undefined,
        initialUrlState.noteId || undefined
      );
      if (initialUrlState.splitDocId) {
        handleOpenInSplitView(initialUrlState.splitDocId);
      }
    }
  }, [initialUrlState, handleOpenDocument, handleOpenInSplitView]);

  const onPopStateNavigation = useCallback(
    (parsed: ParsedUrlState) => {
      if (parsed.docId) {
        if (!activeDoc || activeDoc.id !== parsed.docId) {
          handleOpenDocument(parsed.docId, parsed.page || undefined, parsed.noteId || undefined);
        } else if (parsed.page && parsed.page !== activeViewerPage) {
          setTargetJump({
            page: parsed.page,
            noteId: parsed.noteId || undefined,
            timestamp: Date.now(),
          });
        }
      } else {
        if (activeDoc) {
          setActiveDoc(null);
          setSplitViewOpen(false);
        }
      }

      if (parsed.folder !== null) setSelectedFolderPath(parsed.folder);
      if (parsed.tag !== null) setSelectedTagName(parsed.tag);
      if (parsed.status !== null) setSelectedStatusFilter(parsed.status);
      if (parsed.format !== null) setSelectedFormatFilter(parsed.format);
      if (parsed.tab) setSidebarTab(parsed.tab);
    },
    [
      activeDoc,
      activeViewerPage,
      handleOpenDocument,
      setSelectedFolderPath,
      setSelectedTagName,
      setSelectedStatusFilter,
      setSelectedFormatFilter,
    ]
  );

  const { syncUrl } = useUrlState({ onPopStateNavigation });

  // Sync active reading state / filters with URL
  useEffect(() => {
    syncUrl({
      docId: activeDoc?.id || null,
      page: activeViewerPage,
      splitDocId: splitViewOpen && secondaryDoc ? secondaryDoc.id : null,
      folder: selectedFolderPath,
      tag: selectedTagName,
      status: selectedStatusFilter,
      format: selectedFormatFilter,
      tab: sidebarTab,
      noteId: targetJump?.noteId || null,
    });
  }, [
    activeDoc?.id,
    activeViewerPage,
    splitViewOpen,
    secondaryDoc?.id,
    selectedFolderPath,
    selectedTagName,
    selectedStatusFilter,
    selectedFormatFilter,
    sidebarTab,
    targetJump?.noteId,
    syncUrl,
  ]);

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

  const handleEnrichActiveDoc = async () => {
    if (!activeDoc || enrichingDoc) return;
    setEnrichingDoc(true);
    try {
      const updated = await api.enrichDocumentMetadata(activeDoc.id);
      setActiveDoc(updated);
      setSecondaryDoc((prev) => (prev && prev.id === updated.id ? updated : prev));
      setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setAllDocumentsList((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setRecentDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    } catch (err) {
      console.error('Failed to enrich document metadata:', err);
    } finally {
      setEnrichingDoc(false);
    }
  };

  const handleSaveMetadata = async (metadataPayload: UpdateMetadataPayload) => {
    if (!activeDoc) return;
    setEnrichingDoc(true);
    try {
      const updated = await api.updateDocumentMetadata(activeDoc.id, metadataPayload);
      setActiveDoc(updated);
      setSecondaryDoc((prev) => (prev && prev.id === updated.id ? updated : prev));
      setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setAllDocumentsList((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setRecentDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    } catch (err) {
      console.error('Failed to update document metadata:', err);
    } finally {
      setEnrichingDoc(false);
    }
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
    loadLibraryData();
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
    loadLibraryData();
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Bar */}
      <header className="h-14 shrink-0 px-4 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 z-30">
        {/* Brand & Left Sidebar Toggle */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={toggleCollapsed}
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
        <InstantSearchBar
          activeFacetCount={activeFacetCount}
          currentFilterParams={currentFilterParams}
          onNavigateToDocument={(docId, page) => handleOpenDocument(docId, page)}
        />

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
            onClick={toggleFullscreen}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
            title={isFullscreen ? "Vollbildmodus beenden (F)" : "Vollbildmodus aktivieren (F)"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4 text-blue-500" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
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
        {/* Left Sidebar: 5 Tabs (Folders, Gliederung/TOC, Tags, Notes, RAG) + Resize Splitter */}
        <LeftSidebar
          sidebarTab={sidebarTab}
          setSidebarTab={setSidebarTab}
          sidebarWidth={sidebarWidth}
          sidebarCollapsed={sidebarCollapsed}
          isResizingSidebar={isResizingSidebar}
          onStartResizing={startResizing}
          onResetWidth={resetSidebarWidth}
          tree={tree}
          totalDocs={totalDocs}
          selectedFolderPath={selectedFolderPath}
          activeDoc={activeDoc}
          splitViewOpen={splitViewOpen}
          secondaryDoc={secondaryDoc}
          onSelectFolder={(path) => {
            setSelectedFolderPath(path);
            setActiveDoc(null);
            setSplitViewOpen(false);
          }}
          onOpenDocument={handleOpenDocument}
          onOpenInSplitView={handleOpenInSplitView}
          docOutline={docOutline}
          outlineLoading={outlineLoading}
          tocFilter={tocFilter}
          setTocFilter={setTocFilter}
          activeViewerPage={activeViewerPage}
          onJumpToPage={(page) => setTargetJump({ page, timestamp: Date.now() })}
          tags={tags}
          selectedTagName={selectedTagName}
          setSelectedTagName={(name) => {
            setSelectedTagName(name);
            setActiveDoc(null);
            setSplitViewOpen(false);
          }}
          onCreateTag={async (name, colorHex) => {
            const created = await api.createTag(name, colorHex);
            setTags((prev) => [...prev.filter((t) => t.id !== created.id), created]);
          }}
          onDeleteTag={handleDeleteTag}
          globalNotes={globalNotes}
          noteSearchQuery={noteSearchQuery}
          setNoteSearchQuery={setNoteSearchQuery}
          currentFilterParams={currentFilterParams}
          settings={settings}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Main Content Area: Either PDF.js Reader (+ Optional Split-View & Inspector) OR Document Explorer */}
        <main className="flex-1 flex min-w-0 overflow-hidden">
          {activeDoc ? (
            <ReaderWorkspace
              activeDoc={activeDoc}
              docNotes={docNotes}
              targetJump={targetJump}
              inspectorOpen={inspectorOpen}
              settings={settings}
              splitViewOpen={splitViewOpen}
              secondaryDoc={secondaryDoc}
              secondaryDocNotes={secondaryDocNotes}
              secondaryTargetJump={secondaryTargetJump}
              availableDocuments={allDocumentsList.length > 0 ? allDocumentsList : documents}
              tags={tags}
              enrichingDoc={enrichingDoc}
              onToggleInspector={() => setInspectorOpen((o) => !o)}
              onToggleSplitView={handleToggleSplitView}
              onCloseSecondaryPane={() => setSplitViewOpen(false)}
              onChangeSecondaryDocument={(newDocId) => handleOpenInSplitView(newDocId)}
              onUpdateReadingProgress={handleUpdateReadingProgress}
              onPageChange={setActiveViewerPage}
              onRequestCreateNote={(sel) => {
                setEditingNote(null);
                setPendingSelection(sel);
                setNoteModalOpen(true);
              }}
              onSelectPrimaryNote={(note) => {
                setInspectorOpen(true);
                setTargetJump({
                  page: note.pageNumber,
                  noteId: note.id,
                  timestamp: Date.now(),
                });
              }}
              onSelectSecondaryNote={(note) => {
                setInspectorOpen(true);
                setSecondaryTargetJump({
                  page: note.pageNumber,
                  noteId: note.id,
                  timestamp: Date.now(),
                });
              }}
              onEnrichActiveDoc={handleEnrichActiveDoc}
              onSaveMetadata={handleSaveMetadata}
              onToggleDocTag={handleToggleDocTag}
              onOpenNewNoteModal={(pageNumber) => {
                setEditingNote(null);
                setPendingSelection({
                  documentId: activeDoc.id,
                  pageNumber: targetJump?.page || pageNumber || 1,
                  selectedText: '',
                  boundingBox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.16 },
                });
                setNoteModalOpen(true);
              }}
              onEditNote={(note) => {
                setEditingNote(note);
                setNoteModalOpen(true);
              }}
              onDeleteNote={handleDeleteNote}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
            />
          ) : (
            /* Document Explorer Grid/List View */
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Continue Reading ("Weiterlesen / Zuletzt gelesen") Shelf */}
              {activeFacetCount === 0 && (
                <ContinueReadingShelf
                  recentDocuments={recentDocuments}
                  onOpenDocument={handleOpenDocument}
                />
              )}

              {/* Library Header, Quick Discovery Bar & Faceted Filters */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>
                        {selectedFolderPath
                          ? `Ordner: /${selectedFolderPath}`
                          : selectedTagName
                          ? `Tags: #${selectedTagName.split(',').join(' #')}`
                          : noteTopicFilter.trim()
                          ? `Notizen zum Thema: „${noteTopicFilter.trim()}“`
                          : 'Personal PDF Library'}
                      </span>
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {documents.length} von {facets?.totalDocuments ?? totalDocs} Dokumenten angezeigt
                      {facets && facets.totalNotesCount > 0
                        ? ` • ${facets.totalNotesCount} Lesezettel in ${facets.withNotesCount} PDFs`
                        : ''}
                    </p>
                  </div>
                </div>

                <FacetedFilterBar
                  facets={facets}
                  activeFacetCount={activeFacetCount}
                  selectedStatusFilter={selectedStatusFilter}
                  setSelectedStatusFilter={setSelectedStatusFilter}
                  selectedFormatFilter={selectedFormatFilter}
                  setSelectedFormatFilter={setSelectedFormatFilter}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  setSortBy={setSortBy}
                  setSortDir={setSortDir}
                  facetsPanelOpen={facetsPanelOpen}
                  setFacetsPanelOpen={setFacetsPanelOpen}
                  resetAllFilters={resetAllFilters}
                  noteTopicFilter={noteTopicFilter}
                  setNoteTopicFilter={setNoteTopicFilter}
                  hasNotesFilter={hasNotesFilter}
                  setHasNotesFilter={setHasNotesFilter}
                  hasMetadataFilter={hasMetadataFilter}
                  setHasMetadataFilter={setHasMetadataFilter}
                  minPagesFilter={minPagesFilter}
                  setMinPagesFilter={setMinPagesFilter}
                  maxPagesFilter={maxPagesFilter}
                  setMaxPagesFilter={setMaxPagesFilter}
                  datePresetFilter={datePresetFilter}
                  setDatePresetFilter={setDatePresetFilter}
                  customDateAfter={customDateAfter}
                  setCustomDateAfter={setCustomDateAfter}
                  customDateBefore={customDateBefore}
                  setCustomDateBefore={setCustomDateBefore}
                  yearFromFilter={yearFromFilter}
                  setYearFromFilter={setYearFromFilter}
                  yearToFilter={yearToFilter}
                  setYearToFilter={setYearToFilter}
                  selectedTagName={selectedTagName}
                  onToggleTagFacet={handleToggleTagFacet}
                  onClearTags={() => setSelectedTagName('')}
                />
              </div>

              {documents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center space-y-3">
                  <FileText className="w-10 h-10 text-slate-400 mx-auto stroke-1" />
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    No documents found in this view
                  </div>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Drop PDF files into the <code className="font-mono">/storage</code> directory. WatchService will automatically debounce and index them in place.
                  </p>
                </div>
              ) : (
                <VirtualizedDocumentGrid
                  documents={documents}
                  coverCacheVersion={coverCacheVersion}
                  showCovers={settings.showCovers}
                  coverLayout={settings.coverLayout}
                  onClickDocument={handleOpenDocument}
                  hasMore={hasMoreDocuments}
                  isLoadingMore={isLoadingMore}
                  onLoadMore={handleLoadMore}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {/* Reading Note (Lesezettel) Creation / Editing Modal */}
      {noteModalOpen && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {/* Settings (Einstellungen) Modal */}
      {settingsOpen && (
        <Suspense fallback={null}>
      <SettingsModal
        isOpen={settingsOpen}
        settings={settings}
        darkMode={darkMode}
        onUpdateSettings={setSettings}
        onToggleDarkMode={setDarkMode}
        onClose={() => setSettingsOpen(false)}
        onCoversCleared={() => setCoverCacheVersion((v) => v + 1)}
        onMetadataEnriched={loadLibraryData}
      />
        </Suspense>
      )}
    </div>
  );
};
