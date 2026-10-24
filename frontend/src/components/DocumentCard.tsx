import React from 'react';
import {
  CheckCircle2,
  Clock,
  CircleDashed,
  BookMarked,
  ExternalLink,
  FileText,
  BookOpen,
} from 'lucide-react';
import { DocumentItem, ReadingStatus, formatDocTitle, isEpubDocument } from '../types';
import { DocumentCover } from './DocumentCover';

export interface DocumentCardProps {
  document: DocumentItem;
  coverCacheVersion?: number;
  showCovers: boolean;
  coverLayout: 'top' | 'left' | 'none';
  onClick: () => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = React.memo(
  ({ document: doc, coverCacheVersion = 0, showCovers, coverLayout, onClick }) => {
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

    const status: ReadingStatus = doc.readingStatus || 'UNREAD';
    const isEbook = isEpubDocument(doc);

    const renderFormatBadge = () => {
      const fmt = (doc.format || (doc.fileName.toLowerCase().endsWith('.mobi') ? 'MOBI' : doc.fileName.toLowerCase().endsWith('.azw') || doc.fileName.toLowerCase().endsWith('.azw3') ? 'AZW' : doc.fileName.toLowerCase().endsWith('.epub') ? 'EPUB' : 'PDF')).toUpperCase();
      if (fmt === 'MOBI') {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
            <BookOpen className="w-2.5 h-2.5" />
            MOBI
          </span>
        );
      }
      if (fmt === 'AZW' || fmt === 'AZW3') {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
            <BookOpen className="w-2.5 h-2.5" />
            AZW
          </span>
        );
      }
      if (fmt === 'EPUB') {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30">
            <BookOpen className="w-2.5 h-2.5" />
            EPUB
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20">
          <FileText className="w-2.5 h-2.5" />
          PDF
        </span>
      );
    };

    const renderStatusBadge = () => {
      if (status === 'COMPLETED') {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            Gelesen
          </span>
        );
      }
      if (status === 'READING') {
        const unit = isEbook ? 'Kap.' : 'S.';
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Clock className="w-3 h-3" />
            {unit} {doc.lastReadPage || 1}/{doc.pageCount} ({pct}%)
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

    const isLeftLayout = showCovers && coverLayout === 'left';
    const isTopLayout = showCovers && coverLayout === 'top';

    return (
      <div
        onClick={onClick}
        className={`group cursor-pointer rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-md hover:border-blue-500/60 transition overflow-hidden ${
          isLeftLayout
            ? 'p-3.5 flex gap-3.5'
            : isTopLayout
            ? 'flex flex-col justify-between'
            : 'p-4 flex flex-col justify-between gap-3'
        }`}
      >
        {isTopLayout && (
          <DocumentCover
            document={docWithCacheKey}
            className="w-full h-56 border-b border-slate-100 dark:border-slate-800 group-hover:scale-[1.01] transition-transform"
          />
        )}

        {isLeftLayout && (
          <DocumentCover
            document={docWithCacheKey}
            className="w-24 sm:w-28 aspect-[3/4] shrink-0 rounded-lg border border-slate-200/80 dark:border-slate-800 shadow-xs group-hover:scale-[1.02] transition-transform"
          />
        )}

        <div
          className={`flex-1 min-w-0 flex flex-col justify-between ${
            isTopLayout ? 'p-4 gap-3' : isLeftLayout ? 'gap-2' : 'gap-3'
          }`}
        >
          <div className={isLeftLayout ? 'space-y-1.5' : 'space-y-2'}>
            <div className="flex items-start justify-between gap-2">
              {!showCovers && (
                <div
                  className={`p-2 rounded-lg shrink-0 mr-0.5 ${
                    isEbook
                      ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                      : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  }`}
                >
                  {isEbook ? <BookOpen className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3
                  className="font-semibold text-sm text-slate-900 dark:text-slate-100 group-hover:text-blue-500 transition line-clamp-2 break-words"
                  title={doc.metaTitle ? `${doc.metaTitle} (${doc.fileName})` : doc.fileName}
                >
                  {formatDocTitle(doc)}
                </h3>
                {(doc.authors || doc.publicationYear) && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 truncate mt-0.5">
                    {doc.authors}
                    {doc.authors && doc.publicationYear ? ' • ' : ''}
                    {doc.publicationYear && (
                      <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {doc.publicationYear}
                      </span>
                    )}
                  </p>
                )}
                <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                  {doc.relativePath}
                </p>
              </div>
              <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-blue-500 shrink-0 mt-0.5" />
            </div>

            <div
              className={`flex flex-wrap items-center gap-1 ${
                isLeftLayout ? 'pt-0.5' : 'pt-1'
              }`}
            >
              {renderFormatBadge()}
              {renderStatusBadge()}
              {(doc.noteCount ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <BookMarked className="w-3 h-3" />
                  {doc.noteCount} {doc.noteCount === 1 ? 'Notiz' : 'Notizen'}
                </span>
              )}
              {doc.doi && (
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono text-[10px]">
                  DOI
                </span>
              )}
              {doc.isbn && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">
                  ISBN
                </span>
              )}
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

          <div
            className={`space-y-2 border-t border-slate-100 dark:border-slate-800/80 ${
              isLeftLayout ? 'pt-2' : isTopLayout ? 'pt-2' : 'pt-2.5'
            }`}
          >
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
);

DocumentCard.displayName = 'DocumentCard';

