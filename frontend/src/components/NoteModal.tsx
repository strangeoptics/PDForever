import React, { useState, useEffect } from 'react';
import { X, BookMarked, Quote, Crosshair } from 'lucide-react';
import { BoundingBox, ReadingNote } from '../types';

interface NoteModalProps {
  isOpen: boolean;
  pageNumber: number;
  selectedText: string;
  boundingBox: BoundingBox;
  editingNote?: ReadingNote | null;
  onClose: () => void;
  onSave: (data: {
    pageNumber: number;
    selectedText: string;
    noteMarkdown: string;
    boundingBox: BoundingBox;
  }) => Promise<void>;
}

export const NoteModal: React.FC<NoteModalProps> = ({
  isOpen,
  pageNumber,
  selectedText,
  boundingBox,
  editingNote,
  onClose,
  onSave,
}) => {
  const [quote, setQuote] = useState(selectedText);
  const [markdown, setMarkdown] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingNote) {
      setQuote(editingNote.selectedText || '');
      setMarkdown(editingNote.noteMarkdown || '');
    } else {
      setQuote(selectedText || '');
      setMarkdown('');
    }
  }, [editingNote, selectedText, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!markdown.trim()) return;
    setSaving(true);
    try {
      await onSave({
        pageNumber: editingNote ? editingNote.pageNumber : pageNumber,
        selectedText: quote,
        noteMarkdown: markdown,
        boundingBox: editingNote ? editingNote.boundingBox : boundingBox,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const activeBox = editingNote ? editingNote.boundingBox : boundingBox;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
              <BookMarked className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                {editingNote ? 'Edit Reading Note (Lesezettel)' : 'Create Reading Note (Lesezettel)'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <span>Page {editingNote ? editingNote.pageNumber : pageNumber}</span>
                <span>•</span>
                <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                  <Crosshair className="w-3 h-3" />
                  [{activeBox.x1.toFixed(2)}, {activeBox.y1.toFixed(2)} → {activeBox.x2.toFixed(2)}, {activeBox.y2.toFixed(2)}]
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
              <Quote className="w-3.5 h-3.5" />
              Selected Excerpt
            </label>
            <textarea
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              rows={3}
              placeholder="Exact quote from PDF page..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-amber-50/40 dark:bg-amber-950/20 px-3.5 py-2.5 text-sm italic text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Your Thoughts / Summary (Markdown)
              </label>
              <span className="text-[11px] text-slate-400">Supports **bold**, *italics*, lists, code</span>
            </div>
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              rows={5}
              required
              autoFocus
              placeholder="Write your reading note, synthesis, or critique in Markdown..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !markdown.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white shadow-sm"
            >
              {saving ? 'Saving…' : editingNote ? 'Update Note' : 'Save Reading Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

