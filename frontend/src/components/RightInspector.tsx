import React, { useState, useEffect } from 'react';
import {
  Clock,
  CircleDashed,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  Edit3,
  ExternalLink,
  Tag as TagIcon,
  BookMarked,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  DocumentItem,
  ReadingNote,
  ReadingStatus,
  Tag,
  UpdateMetadataPayload,
  UpdateReadingProgressPayload,
} from '../types';

export interface RightInspectorProps {
  activeDoc: DocumentItem;
  tags: Tag[];
  docNotes: ReadingNote[];
  enrichingDoc: boolean;
  onUpdateReadingProgress: (docId: string, payload: UpdateReadingProgressPayload) => void;
  onEnrichActiveDoc: () => void;
  onSaveMetadata: (metadata: UpdateMetadataPayload) => Promise<void>;
  onToggleDocTag: (tag: Tag) => void;
  onOpenNewNoteModal: (pageNumber: number) => void;
  onEditNote: (note: ReadingNote) => void;
  onDeleteNote: (noteId: string) => void;
  onSelectNote: (note: ReadingNote) => void;
}

export const RightInspector: React.FC<RightInspectorProps> = React.memo(
  ({
    activeDoc,
    tags,
    docNotes,
    enrichingDoc,
    onUpdateReadingProgress,
    onEnrichActiveDoc,
    onSaveMetadata,
    onToggleDocTag,
    onOpenNewNoteModal,
    onEditNote,
    onDeleteNote,
    onSelectNote,
  }) => {
    const [editingMetadata, setEditingMetadata] = useState<boolean>(false);
    const [showAbstract, setShowAbstract] = useState<boolean>(false);
    const [metaForm, setMetaForm] = useState<{
      metaTitle: string;
      authors: string;
      publicationYear: string;
      doi: string;
      isbn: string;
      abstractText: string;
    }>({
      metaTitle: '',
      authors: '',
      publicationYear: '',
      doi: '',
      isbn: '',
      abstractText: '',
    });

    // Reset editing state when document changes
    useEffect(() => {
      setEditingMetadata(false);
      setShowAbstract(false);
    }, [activeDoc.id]);

    const handleStartEditMetadata = () => {
      setMetaForm({
        doi: activeDoc.doi || '',
        isbn: activeDoc.isbn || '',
        metaTitle: activeDoc.metaTitle || '',
        authors: activeDoc.authors || '',
        publicationYear: activeDoc.publicationYear ? String(activeDoc.publicationYear) : '',
        abstractText: activeDoc.abstractText || '',
      });
      setEditingMetadata(true);
    };

    const handleFormSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const yearNum = metaForm.publicationYear.trim()
        ? Number.parseInt(metaForm.publicationYear.trim(), 10)
        : 0;

      await onSaveMetadata({
        doi: metaForm.doi.trim(),
        isbn: metaForm.isbn.trim(),
        metaTitle: metaForm.metaTitle.trim(),
        authors: metaForm.authors.trim(),
        publicationYear: Number.isNaN(yearNum) ? 0 : yearNum,
        abstractText: metaForm.abstractText.trim(),
      });
      setEditingMetadata(false);
    };

    return (
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
                    onUpdateReadingProgress(activeDoc.id, {
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

        {/* Document Metadata Section (DOI / ISBN / CrossRef / OpenLibrary / Semantic Scholar) */}
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              Metadaten (DOI / ISBN)
            </h4>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onEnrichActiveDoc}
                disabled={enrichingDoc}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 transition"
                title="Seiten 1–3 nach DOI/ISBN scannen & CrossRef / Semantic Scholar / OpenLibrary abfragen"
              >
                <RefreshCw className={`w-3 h-3 ${enrichingDoc ? 'animate-spin' : ''}`} />
                {enrichingDoc ? 'Lädt…' : 'API-Abfrage'}
              </button>
              <button
                type="button"
                onClick={() =>
                  editingMetadata ? setEditingMetadata(false) : handleStartEditMetadata()
                }
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                title="Metadaten manuell bearbeiten"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {editingMetadata ? (
            <form onSubmit={handleFormSubmit} className="space-y-2 pt-1">
              <input
                type="text"
                value={metaForm.metaTitle}
                onChange={(e) =>
                  setMetaForm((f) => ({ ...f, metaTitle: e.target.value }))
                }
                placeholder="Titel (leer lassen für API-Auflösung via DOI/ISBN)"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="grid grid-cols-3 gap-1.5">
                <input
                  type="text"
                  value={metaForm.authors}
                  onChange={(e) =>
                    setMetaForm((f) => ({ ...f, authors: e.target.value }))
                  }
                  placeholder="Autoren"
                  className="col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  value={metaForm.publicationYear}
                  onChange={(e) =>
                    setMetaForm((f) => ({ ...f, publicationYear: e.target.value }))
                  }
                  placeholder="Jahr"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  value={metaForm.doi}
                  onChange={(e) => setMetaForm((f) => ({ ...f, doi: e.target.value }))}
                  placeholder="DOI (z.B. 10.1038/...)"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={metaForm.isbn}
                  onChange={(e) => setMetaForm((f) => ({ ...f, isbn: e.target.value }))}
                  placeholder="ISBN-13 / ISBN-10"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <textarea
                rows={3}
                value={metaForm.abstractText}
                onChange={(e) =>
                  setMetaForm((f) => ({ ...f, abstractText: e.target.value }))
                }
                placeholder="Abstract / Zusammenfassung…"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingMetadata(false)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={enrichingDoc}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-600 hover:bg-blue-500 text-white"
                >
                  Speichern
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-1.5 text-xs">
              {activeDoc.metaTitle && (
                <div className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                  {activeDoc.metaTitle}
                </div>
              )}
              {(activeDoc.authors || activeDoc.publicationYear) && (
                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  {activeDoc.authors}
                  {activeDoc.authors && activeDoc.publicationYear ? ' • ' : ''}
                  {activeDoc.publicationYear && (
                    <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                      {activeDoc.publicationYear}
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {activeDoc.doi && (
                  <a
                    href={`https://doi.org/${encodeURIComponent(activeDoc.doi)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono text-[10px] hover:underline"
                    title="DOI im Browser öffnen"
                  >
                    DOI: {activeDoc.doi}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
                {activeDoc.isbn && (
                  <a
                    href={`https://openlibrary.org/isbn/${encodeURIComponent(activeDoc.isbn)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[10px] hover:underline"
                    title="ISBN auf OpenLibrary öffnen"
                  >
                    ISBN: {activeDoc.isbn}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
                {activeDoc.metadataSource && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[10px]">
                    {activeDoc.metadataSource}
                  </span>
                )}
              </div>

              {activeDoc.abstractText && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAbstract((s) => !s)}
                    className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {showAbstract ? 'Abstract ausblenden ▲' : 'Abstract anzeigen ▼'}
                  </button>
                  {showAbstract && (
                    <p className="mt-1.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed max-h-44 overflow-y-auto">
                      {activeDoc.abstractText}
                    </p>
                  )}
                </div>
              )}

              {!activeDoc.metaTitle &&
                !activeDoc.authors &&
                !activeDoc.doi &&
                !activeDoc.isbn && (
                  <p className="text-[11px] text-slate-400">
                    Noch keine DOI/ISBN-Metadaten hinterlegt. Klicken Sie auf{' '}
                    <span className="font-medium text-emerald-500">API-Abfrage</span> oder{' '}
                    <span className="font-medium">Bearbeiten</span>.
                  </p>
                )}
            </div>
          )}
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
                    onClick={() => onToggleDocTag(tag)}
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
            onClick={() => onOpenNewNoteModal(activeDoc.lastReadPage || 1)}
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
                onClick={() => onSelectNote(note)}
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
                        onEditNote(note);
                      }}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      title="Edit Note"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteNote(note.id);
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
    );
  }
);

RightInspector.displayName = 'RightInspector';
