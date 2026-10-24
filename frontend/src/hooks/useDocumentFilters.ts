import { useState, useMemo, useCallback } from 'react';
import { DocumentFilterParams } from '../types';

export interface InitialFilterValues {
  folder?: string | null;
  tag?: string | null;
  status?: string | null;
  format?: string | null;
}

export function useDocumentFilters(initialValues?: InitialFilterValues) {
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>(initialValues?.folder || '');
  const [selectedTagName, setSelectedTagName] = useState<string>(initialValues?.tag || '');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>(initialValues?.status || '');
  const [selectedFormatFilter, setSelectedFormatFilter] = useState<string>(initialValues?.format || '');
  const [facetsPanelOpen, setFacetsPanelOpen] = useState<boolean>(false);
  const [minPagesFilter, setMinPagesFilter] = useState<string>('');
  const [maxPagesFilter, setMaxPagesFilter] = useState<string>('');
  const [hasNotesFilter, setHasNotesFilter] = useState<boolean | null>(null);
  const [noteTopicFilter, setNoteTopicFilter] = useState<string>('');
  const [datePresetFilter, setDatePresetFilter] = useState<'' | '7d' | '30d' | '365d' | 'custom'>('');
  const [customDateAfter, setCustomDateAfter] = useState<string>('');
  const [customDateBefore, setCustomDateBefore] = useState<string>('');
  const [yearFromFilter, setYearFromFilter] = useState<string>('');
  const [yearToFilter, setYearToFilter] = useState<string>('');
  const [hasMetadataFilter, setHasMetadataFilter] = useState<boolean | null>(null);
  const [sortBy, setSortBy] = useState<string>('fileName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const currentFilterParams = useMemo<DocumentFilterParams>(() => {
    let modifiedAfter: string | undefined;
    let modifiedBefore: string | undefined;
    const now = Date.now();
    if (datePresetFilter === '7d') {
      modifiedAfter = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
    } else if (datePresetFilter === '30d') {
      modifiedAfter = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
    } else if (datePresetFilter === '365d') {
      modifiedAfter = new Date(now - 365 * 24 * 3600 * 1000).toISOString();
    } else if (datePresetFilter === 'custom') {
      if (customDateAfter) {
        modifiedAfter = new Date(`${customDateAfter}T00:00:00Z`).toISOString();
      }
      if (customDateBefore) {
        modifiedBefore = new Date(`${customDateBefore}T23:59:59Z`).toISOString();
      }
    }

    const minP = minPagesFilter.trim() ? Number.parseInt(minPagesFilter.trim(), 10) : null;
    const maxP = maxPagesFilter.trim() ? Number.parseInt(maxPagesFilter.trim(), 10) : null;
    const yFrom = yearFromFilter.trim() ? Number.parseInt(yearFromFilter.trim(), 10) : null;
    const yTo = yearToFilter.trim() ? Number.parseInt(yearToFilter.trim(), 10) : null;

    return {
      path: selectedFolderPath || undefined,
      tag: selectedTagName || undefined,
      status: selectedStatusFilter || undefined,
      format: selectedFormatFilter || undefined,
      minPages: minP != null && !Number.isNaN(minP) ? minP : null,
      maxPages: maxP != null && !Number.isNaN(maxP) ? maxP : null,
      hasNotes: hasNotesFilter,
      noteQuery: noteTopicFilter.trim() || undefined,
      modifiedAfter,
      modifiedBefore,
      yearFrom: yFrom != null && !Number.isNaN(yFrom) ? yFrom : null,
      yearTo: yTo != null && !Number.isNaN(yTo) ? yTo : null,
      hasMetadata: hasMetadataFilter,
      sortBy,
      sortDir,
      page: 0,
      size: 100,
    };
  }, [
    selectedFolderPath,
    selectedTagName,
    selectedStatusFilter,
    selectedFormatFilter,
    minPagesFilter,
    maxPagesFilter,
    hasNotesFilter,
    noteTopicFilter,
    datePresetFilter,
    customDateAfter,
    customDateBefore,
    yearFromFilter,
    yearToFilter,
    hasMetadataFilter,
    sortBy,
    sortDir,
  ]);

  const activeFacetCount = useMemo(() => {
    let count = 0;
    if (selectedFolderPath) count++;
    if (selectedTagName) count += selectedTagName.split(',').filter(Boolean).length;
    if (selectedStatusFilter) count++;
    if (selectedFormatFilter) count++;
    if (minPagesFilter.trim() || maxPagesFilter.trim()) count++;
    if (hasNotesFilter !== null) count++;
    if (noteTopicFilter.trim()) count++;
    if (datePresetFilter) count++;
    if (yearFromFilter.trim() || yearToFilter.trim()) count++;
    if (hasMetadataFilter !== null) count++;
    return count;
  }, [
    selectedFolderPath,
    selectedTagName,
    selectedStatusFilter,
    selectedFormatFilter,
    minPagesFilter,
    maxPagesFilter,
    hasNotesFilter,
    noteTopicFilter,
    datePresetFilter,
    yearFromFilter,
    yearToFilter,
    hasMetadataFilter,
  ]);

  const resetAllFilters = useCallback(() => {
    setSelectedFolderPath('');
    setSelectedTagName('');
    setSelectedStatusFilter('');
    setSelectedFormatFilter('');
    setMinPagesFilter('');
    setMaxPagesFilter('');
    setHasNotesFilter(null);
    setNoteTopicFilter('');
    setDatePresetFilter('');
    setCustomDateAfter('');
    setCustomDateBefore('');
    setYearFromFilter('');
    setYearToFilter('');
    setHasMetadataFilter(null);
    setSortBy('fileName');
    setSortDir('asc');
  }, []);

  const handleToggleTagFacet = useCallback((tagName: string) => {
    setSelectedTagName((prev) => {
      const current = prev
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const exists = current.some((t) => t.toLowerCase() === tagName.toLowerCase());
      const next = exists
        ? current.filter((t) => t.toLowerCase() !== tagName.toLowerCase())
        : [...current, tagName];
      return next.join(',');
    });
  }, []);

  return {
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
  };
}

