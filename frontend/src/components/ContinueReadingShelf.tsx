import React from 'react';
import { Clock, Play } from 'lucide-react';
import { DocumentItem, formatDocTitle, isEpubDocument } from '../types';

interface ContinueReadingShelfProps {
  recentDocuments: DocumentItem[];
  onOpenDocument: (docId: string, page: number) => void;
}

export const ContinueReadingShelf: React.FC<ContinueReadingShelfProps> = React.memo(({
  recentDocuments,
  onOpenDocument,
}) => {
  if (recentDocuments.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-amber-500" />
          Zuletzt gelesen & Weiterlesen
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {recentDocuments.slice(0, 3).map((doc) => {
          const isEpub = isEpubDocument(doc);
          const pageOrChapter = isEpub ? `Kap. ${doc.lastReadPage || 1}` : `S. ${doc.lastReadPage || 1}`;
          const progressLabel = isEpub ? `Kapitel ${doc.lastReadPage || 1} von ${doc.pageCount}` : `Seite ${doc.lastReadPage || 1} von ${doc.pageCount}`;
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
              onClick={() => onOpenDocument(doc.id, doc.lastReadPage || 1)}
              className="group cursor-pointer rounded-xl border border-amber-500/30 dark:border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-white to-white dark:from-amber-500/10 dark:via-slate-900 dark:to-slate-900 p-3.5 shadow-xs hover:shadow-md hover:border-amber-500/60 transition flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold tracking-wider uppercase shrink-0 ${
                      isEpub
                        ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30'
                        : 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20'
                    }`}>
                      {isEpub ? 'EPUB' : 'PDF'}
                    </span>
                    <h3
                      className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition truncate"
                      title={doc.metaTitle ? `${doc.metaTitle} (${doc.fileName})` : doc.fileName}
                    >
                      {formatDocTitle(doc)}
                    </h3>
                  </div>
                  {(doc.authors || doc.publicationYear) && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                      {doc.authors}
                      {doc.authors && doc.publicationYear ? ' • ' : ''}
                      {doc.publicationYear ?? ''}
                    </p>
                  )}
                  <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                    {doc.relativePath}
                  </p>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 text-slate-950 font-semibold text-[11px] shadow-xs group-hover:scale-105 transition">
                  <Play className="w-3 h-3 fill-current" />
                  {pageOrChapter}
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>
                    {progressLabel}
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
  );
});

