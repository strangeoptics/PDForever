import React, { useEffect, useState, useCallback, useRef } from 'react';
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
} from 'lucide-react';
import { api } from './api';
import {
  BoundingBox,
  DocumentItem,
  ReadingNote,
  SearchResultGroup,
  Tag,
  TreeNode,
} from './types';
import { PdfViewer } from './components/PdfViewer';
import { NoteModal } from './components/NoteModal';

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
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [sidebarTab, setSidebarTab] = useState<'folders' | 'tags' | 'notes'>('folders');

  // Data state
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [totalDocs, setTotalDocs] = useState<number>(0);
  const [tags, setTags] = useState<Tag[]>([]);
  const [globalNotes, setGlobalNotes] = useState<ReadingNote[]>([]);
  const [docNotes, setDocNotes] = useState<ReadingNote[]>([]);

  // Filter & Selection state
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>('');
  const [selectedTagName, setSelectedTagName] = useState<string>('');
  const [activeDoc, setActiveDoc] = useState<DocumentItem | null>(null);
  const [targetJump, setTargetJump] = useState<{
    page: number;
    noteId?: string;
    timestamp: number;
  } | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);

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
  }, [darkMode]);

  const loadLibraryData = useCallback(async () => {
    try {
      const [treeData, tagsData, docsPage, allNotes] = await Promise.all([
        api.getTree(),
        api.getTags(),
        api.getDocuments({ path: selectedFolderPath, tag: selectedTagName, page: 0, size: 100 }),
        api.searchNotes(noteSearchQuery),
      ]);
      setTree(treeData);
      setTags(tagsData);
      setDocuments(docsPage.content);
      setTotalDocs(docsPage.totalElements);
      setGlobalNotes(allNotes);
    } catch (err) {
      console.error('Error loading library data:', err);
    }
  }, [selectedFolderPath, selectedTagName, noteSearchQuery]);

  useEffect(() => {
    loadLibraryData();
  }, [loadLibraryData]);

  // Load notes when active document changes
  useEffect(() => {
    if (!activeDoc) {
      setDocNotes([]);
      return;
    }
    api
      .getDocumentNotes(activeDoc.id)
      .then(setDocNotes)
      .catch((err) => console.error('Failed to load document notes:', err));
  }, [activeDoc]);

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
    async (docId: string, page = 1, noteId?: string) => {
      try {
        const doc = await api.getDocument(docId);
        setActiveDoc(doc);
        setTargetJump({ page, noteId, timestamp: Date.now() });
        setSearchOpen(false);
      } catch (err) {
        console.error('Failed to open document:', err);
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
    if (!activeDoc) return;
    if (editingNote) {
      await api.updateNote(editingNote.id, {
        selectedText: data.selectedText,
        noteMarkdown: data.noteMarkdown,
        boundingBox: data.boundingBox,
      });
    } else {
      await api.createNote({
        documentId: activeDoc.id,
        pageNumber: data.pageNumber,
        selectedText: data.selectedText,
        noteMarkdown: data.noteMarkdown,
        boundingBox: data.boundingBox,
      });
    }
    const [updatedDocNotes, updatedGlobalNotes] = await Promise.all([
      api.getDocumentNotes(activeDoc.id),
      api.searchNotes(noteSearchQuery),
    ]);
    setDocNotes(updatedDocNotes);
    setGlobalNotes(updatedGlobalNotes);
    setEditingNote(null);
  };

  const handleDeleteNote = async (noteId: string) => {
    await api.deleteNote(noteId);
    if (activeDoc) {
      setDocNotes((prev) => prev.filter((n) => n.id !== noteId));
    }
    setGlobalNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Bar */}
      <header className="h-14 shrink-0 px-4 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 z-30">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveDoc(null)}
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
              onClick={() => setActiveDoc(null)}
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
        </div>
      </header>

      {/* 3-Panel Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar: 3 Tabs (Directory Tree, Tag Browser, Global Reading Notes) */}
        <aside className="w-72 sm:w-80 shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90">
          {/* Sidebar Navigation Tabs */}
          <div className="grid grid-cols-3 border-b border-slate-200 dark:border-slate-800 p-1 gap-1 bg-slate-100/60 dark:bg-slate-950/50">
            <button
              onClick={() => setSidebarTab('folders')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${
                sidebarTab === 'folders'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Folder className="w-3.5 h-3.5" />
              Folders
            </button>
            <button
              onClick={() => setSidebarTab('tags')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${
                sidebarTab === 'tags'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <TagIcon className="w-3.5 h-3.5" />
              Tags ({tags.length})
            </button>
            <button
              onClick={() => setSidebarTab('notes')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${
                sidebarTab === 'notes'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <BookMarked className="w-3.5 h-3.5" />
              Notes ({globalNotes.length})
            </button>
          </div>

          {/* Tab 1: Directory Tree */}
          {sidebarTab === 'folders' && (
            <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
              <button
                onClick={() => {
                  setSelectedFolderPath('');
                  setSelectedTagName('');
                  setActiveDoc(null);
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
                    onSelectFolder={(folderPath) => {
                      setSelectedFolderPath(folderPath);
                      setActiveDoc(null);
                    }}
                    onSelectFile={(docId) => handleOpenDocument(docId, 1)}
                  />
                ))}
            </div>
          )}

          {/* Tab 2: Tag Browser */}
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
        </aside>

        {/* Main Content Area: Either PDF.js Reader + Inspector OR Folder/Tag Document Explorer */}
        <main className="flex-1 flex min-w-0 overflow-hidden">
          {activeDoc ? (
            <>
              <div className="flex-1 min-w-0 h-full">
                <PdfViewer
                  document={activeDoc}
                  notes={docNotes}
                  targetJump={targetJump}
                  inspectorOpen={inspectorOpen}
                  onToggleInspector={() => setInspectorOpen((o) => !o)}
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

              {/* Right Split-Pane Inspector: Document Tags & Reading Notes (Lesezettel) */}
              {inspectorOpen && (
                <aside className="w-80 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full overflow-hidden">
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
                          pageNumber: targetJump?.page || 1,
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
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
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

                {(selectedFolderPath || selectedTagName) && (
                  <button
                    onClick={() => {
                      setSelectedFolderPath('');
                      setSelectedTagName('');
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-200/70 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700"
                  >
                    Reset Filters
                  </button>
                )}
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
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => handleOpenDocument(doc.id, 1)}
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

                        {doc.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
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
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-mono">{doc.pageCount} pages</span>
                        <span className="font-mono">
                          {(doc.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                        </span>
                      </div>
                    </div>
                  ))}
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
    </div>
  );
};

interface DirectoryTreeItemProps {
  node: TreeNode;
  level: number;
  selectedFolderPath: string;
  activeDocId: string | null;
  onSelectFolder: (path: string) => void;
  onSelectFile: (docId: string) => void;
}

const DirectoryTreeItem: React.FC<DirectoryTreeItemProps> = ({
  node,
  level,
  selectedFolderPath,
  activeDocId,
  onSelectFolder,
  onSelectFile,
}) => {
  const [expanded, setExpanded] = useState<boolean>(level < 2);

  if (node.type === 'file') {
    const isSelected = node.documentId !== null && node.documentId === activeDocId;
    return (
      <button
        onClick={() => node.documentId && onSelectFile(node.documentId)}
        style={{ paddingLeft: `${level * 12 + 10}px` }}
        className={`w-full flex items-center justify-between pr-2 py-1.5 rounded-lg text-xs transition text-left ${
          isSelected
            ? 'bg-blue-600 text-white font-medium'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800/70 text-slate-600 dark:text-slate-300'
        }`}
        title={node.path}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <FileText className="w-3.5 h-3.5 shrink-0 opacity-75" />
          <span className="truncate">{node.name}</span>
        </span>
        {node.pageCount !== null && (
          <span
            className={`text-[10px] font-mono shrink-0 ml-1.5 ${
              isSelected ? 'text-blue-100' : 'text-slate-400'
            }`}
          >
            {node.pageCount}p
          </span>
        )}
      </button>
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
              onSelectFolder={onSelectFolder}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
};

