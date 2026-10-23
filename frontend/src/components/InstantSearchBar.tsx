import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Sparkles, SlidersHorizontal, FileText } from 'lucide-react';
import { api } from '../api';
import { DocumentFilterParams, SearchResultGroup } from '../types';

export interface InstantSearchBarProps {
  activeFacetCount: number;
  currentFilterParams: DocumentFilterParams;
  onNavigateToDocument: (documentId: string, pageNumber: number) => void;
}

export const InstantSearchBar: React.FC<InstantSearchBarProps> = ({
  activeFacetCount,
  currentFilterParams,
  onNavigateToDocument,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResultGroup[]>([]);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searching, setSearching] = useState<boolean>(false);
  const [applyFacetsToSearch, setApplyFacetsToSearch] = useState<boolean>(true);

  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  // Debounced search query
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
        .searchLucene(q, applyFacetsToSearch ? currentFilterParams : undefined)
        .then((res) => {
          setSearchResults(res);
          setSearchOpen(true);
        })
        .catch((err) => {
          console.error('Instant Lucene search failed:', err);
          setSearchResults([]);
        })
        .finally(() => setSearching(false));
    }, 280);

    return () => clearTimeout(timer);
  }, [searchQuery, applyFacetsToSearch, currentFilterParams]);

  // Close search popover on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelectResult = (docId: string, pageNumber: number) => {
    setSearchOpen(false);
    onNavigateToDocument(docId, pageNumber);
  };

  return (
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
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              {searching
                ? 'Searching Lucene page index…'
                : `${searchResults.reduce((acc, g) => acc + g.matches.length, 0)} page matches across ${searchResults.length} documents`}
            </span>
            <div className="flex items-center gap-3">
              {activeFacetCount > 0 && (
                <button
                  type="button"
                  onClick={() => setApplyFacetsToSearch((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition ${
                    applyFacetsToSearch
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-slate-300 dark:border-slate-700 text-slate-500'
                  }`}
                  title="Aktive Facetten-Filter auf die Lucene-Volltextsuche anwenden"
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  {applyFacetsToSearch
                    ? `Mit ${activeFacetCount} Filter(n)`
                    : 'Alle PDFs (ohne Filter)'}
                </button>
              )}
              <span className="hidden sm:inline">Click any passage to jump to page</span>
            </div>
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
                    onClick={() => handleSelectResult(group.docId, group.matches[0]?.pageNumber || 1)}
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
                      onClick={() => handleSelectResult(group.docId, m.pageNumber)}
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
  );
};

