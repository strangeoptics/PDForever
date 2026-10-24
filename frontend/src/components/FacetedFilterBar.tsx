import React from 'react';
import {
  ArrowUpDown,
  SlidersHorizontal,
  BookMarked,
  Sparkles,
  X,
  FileText,
  Calendar,
  Tag as TagIcon,
} from 'lucide-react';
import { DocumentFacets } from '../types';

export interface FacetedFilterBarProps {
  facets: DocumentFacets | null;
  activeFacetCount: number;
  selectedStatusFilter: string;
  setSelectedStatusFilter: (val: string) => void;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  setSortBy: (val: string) => void;
  setSortDir: (val: 'asc' | 'desc') => void;
  facetsPanelOpen: boolean;
  setFacetsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  resetAllFilters: () => void;
  noteTopicFilter: string;
  setNoteTopicFilter: (val: string) => void;
  hasNotesFilter: boolean | null;
  setHasNotesFilter: React.Dispatch<React.SetStateAction<boolean | null>>;
  hasMetadataFilter: boolean | null;
  setHasMetadataFilter: React.Dispatch<React.SetStateAction<boolean | null>>;
  minPagesFilter: string;
  setMinPagesFilter: (val: string) => void;
  maxPagesFilter: string;
  setMaxPagesFilter: (val: string) => void;
  datePresetFilter: '' | '7d' | '30d' | '365d' | 'custom';
  setDatePresetFilter: (val: '' | '7d' | '30d' | '365d' | 'custom') => void;
  customDateAfter: string;
  setCustomDateAfter: (val: string) => void;
  customDateBefore: string;
  setCustomDateBefore: (val: string) => void;
  yearFromFilter: string;
  setYearFromFilter: (val: string) => void;
  yearToFilter: string;
  setYearToFilter: (val: string) => void;
  selectedTagName: string;
  onToggleTagFacet: (tagName: string) => void;
  onClearTags: () => void;
}

export const FacetedFilterBar: React.FC<FacetedFilterBarProps> = React.memo(({
  facets,
  activeFacetCount,
  selectedStatusFilter,
  setSelectedStatusFilter,
  sortBy,
  sortDir,
  setSortBy,
  setSortDir,
  facetsPanelOpen,
  setFacetsPanelOpen,
  resetAllFilters,
  noteTopicFilter,
  setNoteTopicFilter,
  hasNotesFilter,
  setHasNotesFilter,
  hasMetadataFilter,
  setHasMetadataFilter,
  minPagesFilter,
  setMinPagesFilter,
  maxPagesFilter,
  setMaxPagesFilter,
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
  selectedTagName,
  onToggleTagFacet,
  onClearTags,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Reading Status Filter Pills with Facet Counts */}
        <div className="inline-flex rounded-xl p-1 bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {(
            [
              { value: '', label: 'Alle', count: facets?.totalDocuments },
              { value: 'READING', label: 'Am Lesen', count: facets?.readingCount },
              { value: 'UNREAD', label: 'Ungelesen', count: facets?.unreadCount },
              { value: 'COMPLETED', label: 'Gelesen', count: facets?.completedCount },
            ] as const
          ).map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSelectedStatusFilter(tab.value)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1 ${
                selectedStatusFilter === tab.value
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="text-[10px] font-mono opacity-70">({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sort Selector */}
          <div className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              value={`${sortBy}:${sortDir}`}
              onChange={(e) => {
                const [field, dir] = e.target.value.split(':');
                setSortBy(field);
                setSortDir((dir as 'asc' | 'desc') || 'asc');
              }}
              aria-label="Sortierung"
              className="bg-transparent text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="fileName:asc" className="bg-white dark:bg-slate-900">
                Titel / Dateiname (A–Z)
              </option>
              <option value="fileName:desc" className="bg-white dark:bg-slate-900">
                Titel / Dateiname (Z–A)
              </option>
              <option value="lastModifiedFs:desc" className="bg-white dark:bg-slate-900">
                Dateidatum (Neueste zuerst)
              </option>
              <option value="lastModifiedFs:asc" className="bg-white dark:bg-slate-900">
                Dateidatum (Älteste zuerst)
              </option>
              <option value="pageCount:desc" className="bg-white dark:bg-slate-900">
                Seitenanzahl (Absteigend)
              </option>
              <option value="pageCount:asc" className="bg-white dark:bg-slate-900">
                Seitenanzahl (Aufsteigend)
              </option>
              <option value="publicationYear:desc" className="bg-white dark:bg-slate-900">
                Erscheinungsjahr (Neueste)
              </option>
              <option value="noteCount:desc" className="bg-white dark:bg-slate-900">
                Meiste Lesezettel
              </option>
              <option value="lastOpenedAt:desc" className="bg-white dark:bg-slate-900">
                Zuletzt geöffnet
              </option>
            </select>
          </div>

          {/* Toggle Faceted Discovery Panel */}
          <button
            type="button"
            onClick={() => setFacetsPanelOpen((o) => !o)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
              facetsPanelOpen || activeFacetCount > 0
                ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Facettierte Filter</span>
            {activeFacetCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-blue-600 text-white text-[10px] font-mono">
                {activeFacetCount}
              </span>
            )}
          </button>

          {activeFacetCount > 0 && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-200/70 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
            >
              Alle Filter zurücksetzen
            </button>
          )}
        </div>
      </div>

      {/* Quick Discovery Filter Bar (1-Click Smart Facets + Note Topic Search) */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Direct "Zeige mir alle Paper mit Notizen zum Thema X" Input */}
        <div className="relative min-w-[240px] sm:min-w-[290px]">
          <BookMarked className="w-3.5 h-3.5 text-amber-500 absolute left-3 top-2 pointer-events-none" />
          <input
            type="text"
            value={noteTopicFilter}
            onChange={(e) => setNoteTopicFilter(e.target.value)}
            placeholder="PDFs mit Notizen zum Thema X filtern…"
            className="w-full pl-8 pr-7 py-1 rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {noteTopicFilter && (
            <button
              type="button"
              onClick={() => setNoteTopicFilter('')}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Quick Chip: Only Documents with Reading Notes */}
        <button
          type="button"
          onClick={() =>
            setHasNotesFilter((prev) => (prev === true ? null : true))
          }
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition ${
            hasNotesFilter === true
              ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-amber-500/50'
          }`}
        >
          <BookMarked className="w-3 h-3 text-amber-500" />
          <span>Mit Lesezetteln</span>
          {facets && (
            <span className="text-[10px] font-mono opacity-75">
              ({facets.withNotesCount})
            </span>
          )}
        </button>

        {/* Quick Chip: Only Documents with DOI / ISBN Metadata */}
        <button
          type="button"
          onClick={() =>
            setHasMetadataFilter((prev) => (prev === true ? null : true))
          }
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition ${
            hasMetadataFilter === true
              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-emerald-500/50'
          }`}
        >
          <Sparkles className="w-3 h-3 text-emerald-500" />
          <span>Mit DOI / ISBN</span>
          {facets && (
            <span className="text-[10px] font-mono opacity-75">
              ({facets.withMetadataCount})
            </span>
          )}
        </button>

        {/* Quick Page Range Buckets */}
        {(
          [
            {
              label: 'Kurz (1–20 S.)',
              min: '1',
              max: '20',
              count: facets?.shortDocsCount,
            },
            {
              label: 'Mittel (21–100 S.)',
              min: '21',
              max: '100',
              count: facets?.mediumDocsCount,
            },
            {
              label: 'Buch (101+ S.)',
              min: '101',
              max: '',
              count: facets?.longDocsCount,
            },
          ] as const
        ).map((bucket) => {
          const isBucketActive =
            minPagesFilter === bucket.min && maxPagesFilter === bucket.max;
          return (
            <button
              key={bucket.label}
              type="button"
              onClick={() => {
                if (isBucketActive) {
                  setMinPagesFilter('');
                  setMaxPagesFilter('');
                } else {
                  setMinPagesFilter(bucket.min);
                  setMaxPagesFilter(bucket.max);
                }
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                isBucketActive
                  ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-blue-500/40'
              }`}
            >
              <span>{bucket.label}</span>
              {bucket.count !== undefined && (
                <span className="text-[10px] font-mono opacity-75">
                  ({bucket.count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Expanded Faceted Filter Drawer */}
      {facetsPanelOpen && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Facet Column 1: Lesezettel & Themen-Filter */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <BookMarked className="w-3.5 h-3.5 text-amber-500" />
                Lesezettel & Zitate
              </label>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { val: null, label: 'Alle' },
                    { val: true, label: 'Mit Notizen' },
                    { val: false, label: 'Ohne Notizen' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={String(opt.val)}
                    type="button"
                    onClick={() => setHasNotesFilter(opt.val)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition ${
                      hasNotesFilter === opt.val
                        ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={noteTopicFilter}
                onChange={(e) => setNoteTopicFilter(e.target.value)}
                placeholder="Notizen zum Thema X (z.B. Qubits)…"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Facet Column 2: Seitenanzahl-Bereich */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-500" />
                  Seitenanzahl-Bereich
                </span>
                {facets && facets.maxPageCount > 0 && (
                  <span className="font-mono text-[10px] text-slate-400">
                    {facets.minPageCount}–{facets.maxPageCount} S.
                  </span>
                )}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-400 block mb-0.5">
                    Mindestseiten
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={minPagesFilter}
                    onChange={(e) => setMinPagesFilter(e.target.value)}
                    placeholder={facets ? String(facets.minPageCount || 1) : '1'}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block mb-0.5">
                    Höchstseiten
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={maxPagesFilter}
                    onChange={(e) => setMaxPagesFilter(e.target.value)}
                    placeholder={facets ? String(facets.maxPageCount || 500) : '500'}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Facet Column 3: Dateidatum (Filesystem) */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                Dateidatum (Geändert)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {(
                  [
                    { id: '', label: 'Alle' },
                    { id: '7d', label: '7 Tage' },
                    { id: '30d', label: '30 Tage' },
                    { id: '365d', label: '1 Jahr' },
                    { id: 'custom', label: 'Zeitraum…' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setDatePresetFilter(preset.id)}
                    className={`py-1 px-2 rounded-lg text-xs font-medium border transition ${
                      datePresetFilter === preset.id
                        ? 'border-indigo-500 bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {datePresetFilter === 'custom' && (
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <input
                    type="date"
                    value={customDateAfter}
                    onChange={(e) => setCustomDateAfter(e.target.value)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <input
                    type="date"
                    value={customDateBefore}
                    onChange={(e) => setCustomDateBefore(e.target.value)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
            </div>

            {/* Facet Column 4: Erscheinungsjahr & DOI/ISBN */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                  Publikationsjahr & DOI/ISBN
                </span>
                {facets?.minPublicationYear && facets?.maxPublicationYear && (
                  <span className="font-mono text-[10px] text-slate-400">
                    {facets.minPublicationYear}–{facets.maxPublicationYear}
                  </span>
                )}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={yearFromFilter}
                  onChange={(e) => setYearFromFilter(e.target.value)}
                  placeholder="Ab Jahr (z.B. 2015)"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input
                  type="number"
                  value={yearToFilter}
                  onChange={(e) => setYearToFilter(e.target.value)}
                  placeholder="Bis Jahr (z.B. 2026)"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { val: null, label: 'Alle' },
                    { val: true, label: 'Mit DOI/ISBN' },
                    { val: false, label: 'Ohne Meta' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={String(opt.val)}
                    type="button"
                    onClick={() => setHasMetadataFilter(opt.val)}
                    className={`py-1 px-2 rounded-lg text-[11px] font-medium border transition ${
                      hasMetadataFilter === opt.val
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Tag Facets Row (Multi-Select) */}
          {facets && facets.tags.length > 0 && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <TagIcon className="w-3.5 h-3.5" />
                  Nach Tags filtern (Kombination möglich)
                </span>
                {selectedTagName && (
                  <button
                    type="button"
                    onClick={onClearTags}
                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Tag-Auswahl aufheben
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {facets.tags.map((tf) => {
                  const selectedSet = selectedTagName
                    .split(',')
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean);
                  const isSelected = selectedSet.includes(tf.name.toLowerCase());
                  return (
                    <button
                      key={tf.id}
                      type="button"
                      onClick={() => onToggleTagFacet(tf.name)}
                      style={{
                        borderColor: tf.colorHex,
                        backgroundColor: isSelected ? tf.colorHex : `${tf.colorHex}14`,
                        color: isSelected ? '#ffffff' : tf.colorHex,
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition hover:scale-105"
                    >
                      <span>#{tf.name}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                          isSelected ? 'bg-black/20 text-white' : 'bg-black/5 dark:bg-white/10'
                        }`}
                      >
                        {tf.documentCount}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

