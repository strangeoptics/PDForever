import React, { useState, useMemo, Suspense, lazy } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  Tag as TagIcon,
  BookMarked,
  Search,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Library,
  Columns2,
  ListTree,
  Loader2,
  Bot,
  Settings,
  GripVertical,
} from 'lucide-react';
import {
  AppSettings,
  DocumentFilterParams,
  DocumentItem,
  ReadingNote,
  Tag,
  TocItem,
  TreeNode,
} from '../types';
import {
  TocTreeNode,
  countTocItems,
  findActiveTocPage,
} from './TocTreeNode';
const RagChatTab = lazy(() =>
  import('./RagChatTab').then((m) => ({ default: m.RagChatTab }))
);

const TAG_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
];

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

const DirectoryTreeItem: React.FC<DirectoryTreeItemProps> = React.memo(({
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
                if (node.documentId) onOpenInSplitView(node.documentId);
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
});

export interface LeftSidebarProps {
  sidebarTab: 'folders' | 'outline' | 'tags' | 'notes' | 'rag';
  setSidebarTab: (tab: 'folders' | 'outline' | 'tags' | 'notes' | 'rag') => void;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  isResizingSidebar: boolean;
  onStartResizing: (e: React.MouseEvent) => void;
  onResetWidth: () => void;
  tree: TreeNode | null;
  totalDocs: number;
  selectedFolderPath: string;
  activeDoc: DocumentItem | null;
  splitViewOpen: boolean;
  secondaryDoc: DocumentItem | null;
  onSelectFolder: (path: string) => void;
  onOpenDocument: (docId: string, page?: number, noteId?: string) => void;
  onOpenInSplitView: (docId: string) => void;
  docOutline: TocItem[];
  outlineLoading: boolean;
  tocFilter: string;
  setTocFilter: (val: string) => void;
  activeViewerPage: number;
  onJumpToPage: (page: number) => void;
  tags: Tag[];
  selectedTagName: string;
  setSelectedTagName: (val: string) => void;
  onCreateTag: (name: string, colorHex: string) => Promise<void>;
  onDeleteTag: (tagId: number) => Promise<void>;
  globalNotes: ReadingNote[];
  noteSearchQuery: string;
  setNoteSearchQuery: (val: string) => void;
  currentFilterParams: DocumentFilterParams;
  settings: AppSettings;
  onOpenSettings: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = React.memo(({
  sidebarTab,
  setSidebarTab,
  sidebarWidth,
  sidebarCollapsed,
  isResizingSidebar,
  onStartResizing,
  onResetWidth,
  tree,
  totalDocs,
  selectedFolderPath,
  activeDoc,
  splitViewOpen,
  secondaryDoc,
  onSelectFolder,
  onOpenDocument,
  onOpenInSplitView,
  docOutline,
  outlineLoading,
  tocFilter,
  setTocFilter,
  activeViewerPage,
  onJumpToPage,
  tags,
  selectedTagName,
  setSelectedTagName,
  onCreateTag,
  onDeleteTag,
  globalNotes,
  noteSearchQuery,
  setNoteSearchQuery,
  currentFilterParams,
  settings,
  onOpenSettings,
}) => {
  const [newTagName, setNewTagName] = useState<string>('');
  const [newTagColor, setNewTagColor] = useState<string>(TAG_COLORS[0]);

  const totalTocCount = useMemo(() => countTocItems(docOutline), [docOutline]);
  const activeTocPage = useMemo(
    () => findActiveTocPage(docOutline, activeViewerPage),
    [docOutline, activeViewerPage]
  );

  const handleFormSubmitTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    await onCreateTag(newTagName.trim(), newTagColor);
    setNewTagName('');
  };

  if (sidebarCollapsed) {
    return null;
  }

  return (
    <>
      <aside
        style={{ width: `${sidebarWidth}px` }}
        className="shrink-0 flex flex-col bg-white dark:bg-slate-900/90 overflow-hidden"
      >
        {/* Sidebar Navigation Tabs */}
        <div className="grid grid-cols-5 border-b border-slate-200 dark:border-slate-800 p-1 gap-1 bg-slate-100/60 dark:bg-slate-950/50">
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
          <button
            onClick={() => setSidebarTab('rag')}
            className={`flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-medium transition truncate ${
              sidebarTab === 'rag'
                ? 'bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
            title="Lokaler KI-Assistent (RAG / Ollama)"
          >
            <Bot className="w-3.5 h-3.5 shrink-0 text-purple-500" />
            <span className="truncate">RAG</span>
          </button>
        </div>

        {/* Tab 1: Directory Tree */}
        {sidebarTab === 'folders' && (
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
            <button
              onClick={() => onSelectFolder('')}
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
                  onSelectFolder={onSelectFolder}
                  onSelectFile={(docId) => onOpenDocument(docId)}
                  onOpenInSplitView={onOpenInSplitView}
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
                        onSelectPage={(page) => onJumpToPage(page)}
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
              onSubmit={handleFormSubmitTag}
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
                      onClick={() => onDeleteTag(tag.id)}
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

        {/* Tab 4: Global Reading Notes Search */}
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
                    onClick={() => onOpenDocument(note.documentId, note.pageNumber, note.id)}
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

        {/* Tab 5: RAG Chat Assistant */}
        {sidebarTab === 'rag' && (
          <Suspense
            fallback={
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-slate-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                <span className="text-xs">Lade RAG Assistent…</span>
              </div>
            }
          >
            <RagChatTab
              activeDoc={activeDoc}
              currentFilterParams={currentFilterParams}
              customOllamaUrl={settings.customOllamaUrl}
              ragModel={settings.ragModel}
              selectedFolderPath={selectedFolderPath}
              selectedTagName={selectedTagName}
              onNavigateToDocument={(docId, page) => onOpenDocument(docId, page)}
            />
          </Suspense>
        )}

        {/* Sidebar Footer: Quick Access to Settings (Einstellungen) */}
        <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
          <button
            onClick={onOpenSettings}
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

      {/* Horizontal Resize Splitter Handle between Left Sidebar and Main Content Area */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Breite der linken Seitenleiste anpassen"
        onMouseDown={onStartResizing}
        onDoubleClick={onResetWidth}
        title="Ziehen zum Verkleinern/Vergrößern • Doppelklick für Standardbreite (320px)"
        className={`group relative w-1.5 shrink-0 cursor-col-resize flex items-center justify-center transition-colors z-20 ${
          isResizingSidebar
            ? 'bg-blue-600'
            : 'bg-slate-200/80 dark:bg-slate-800/90 hover:bg-blue-500/60 dark:hover:bg-blue-500/60'
        }`}
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        <div
          className={`pointer-events-none flex items-center justify-center w-3.5 h-8 rounded-full border shadow-xs transition-opacity ${
            isResizingSidebar
              ? 'opacity-100 bg-blue-600 text-white border-blue-500'
              : 'opacity-0 group-hover:opacity-100 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-500'
          }`}
        >
          <GripVertical className="w-3 h-3" />
        </div>
      </div>
    </>
  );
});
