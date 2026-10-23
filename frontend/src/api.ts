import {
  CreateNotePayload,
  DocumentFacets,
  DocumentFilterParams,
  DocumentItem,
  MetadataEnrichmentReport,
  PaginatedResponse,
  ReadingNote,
  SearchResultGroup,
  Tag,
  TocItem,
  TreeNode,
  UpdateMetadataPayload,
  UpdateNotePayload,
  UpdateReadingProgressPayload,
} from './types';

const API_BASE = '/api';

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getTree(): Promise<TreeNode> {
    return fetch(`${API_BASE}/tree`).then(handleJson<TreeNode>);
  },

  reconcileTree(): Promise<TreeNode> {
    return fetch(`${API_BASE}/tree/reconcile`, { method: 'POST' }).then(handleJson<TreeNode>);
  },

  getDocuments(params: DocumentFilterParams): Promise<PaginatedResponse<DocumentItem>> {
    const sp = new URLSearchParams();
    if (params.path) sp.set('path', params.path);
    if (params.tag) sp.set('tag', params.tag);
    if (params.status) sp.set('status', params.status);
    if (params.minPages != null) sp.set('minPages', String(params.minPages));
    if (params.maxPages != null) sp.set('maxPages', String(params.maxPages));
    if (params.hasNotes != null) sp.set('hasNotes', String(params.hasNotes));
    if (params.noteQuery && params.noteQuery.trim()) sp.set('noteQuery', params.noteQuery.trim());
    if (params.modifiedAfter) sp.set('modifiedAfter', params.modifiedAfter);
    if (params.modifiedBefore) sp.set('modifiedBefore', params.modifiedBefore);
    if (params.yearFrom != null) sp.set('yearFrom', String(params.yearFrom));
    if (params.yearTo != null) sp.set('yearTo', String(params.yearTo));
    if (params.hasMetadata != null) sp.set('hasMetadata', String(params.hasMetadata));
    if (params.sortBy) sp.set('sortBy', params.sortBy);
    if (params.sortDir) sp.set('sortDir', params.sortDir);
    sp.set('page', String(params.page ?? 0));
    sp.set('size', String(params.size ?? 50));
    return fetch(`${API_BASE}/documents?${sp.toString()}`).then(handleJson<PaginatedResponse<DocumentItem>>);
  },

  getDocumentFacets(path?: string): Promise<DocumentFacets> {
    const sp = new URLSearchParams();
    if (path) sp.set('path', path);
    const qs = sp.toString();
    return fetch(`${API_BASE}/documents/facets${qs ? `?${qs}` : ''}`).then(handleJson<DocumentFacets>);
  },

  getRecentDocuments(limit = 6): Promise<DocumentItem[]> {
    return fetch(`${API_BASE}/documents/recent?limit=${limit}`).then(handleJson<DocumentItem[]>);
  },

  getDocument(id: string): Promise<DocumentItem> {
    return fetch(`${API_BASE}/documents/${id}`).then(handleJson<DocumentItem>);
  },

  getDocumentOutline(id: string): Promise<TocItem[]> {
    return fetch(`${API_BASE}/documents/${id}/outline`).then(handleJson<TocItem[]>);
  },

  updateReadingProgress(id: string, payload: UpdateReadingProgressPayload): Promise<DocumentItem> {
    return fetch(`${API_BASE}/documents/${id}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(handleJson<DocumentItem>);
  },

  enrichDocumentMetadata(id: string): Promise<DocumentItem> {
    return fetch(`${API_BASE}/documents/${id}/enrich`, {
      method: 'POST',
    }).then(handleJson<DocumentItem>);
  },

  updateDocumentMetadata(id: string, payload: UpdateMetadataPayload): Promise<DocumentItem> {
    return fetch(`${API_BASE}/documents/${id}/metadata`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(handleJson<DocumentItem>);
  },

  enrichAllDocuments(force = false): Promise<MetadataEnrichmentReport> {
    return fetch(`${API_BASE}/documents/enrich-all?force=${force}`, {
      method: 'POST',
    }).then(handleJson<MetadataEnrichmentReport>);
  },

  getStreamUrl(id: string): string {
    return `${API_BASE}/documents/${id}/stream`;
  },

  getCoverUrl(id: string, lastModified?: string): string {
    const qs = lastModified ? `?v=${encodeURIComponent(lastModified)}` : '';
    return `${API_BASE}/documents/${id}/cover${qs}`;
  },

  clearCoverCache(): Promise<{ deleted: number }> {
    return fetch(`${API_BASE}/covers`, { method: 'DELETE' }).then(
      handleJson<{ deleted: number }>
    );
  },

  searchLucene(query: string, filters?: DocumentFilterParams): Promise<SearchResultGroup[]> {
    const sp = new URLSearchParams({ q: query });
    if (filters) {
      if (filters.path) sp.set('path', filters.path);
      if (filters.tag) sp.set('tag', filters.tag);
      if (filters.status) sp.set('status', filters.status);
      if (filters.minPages != null) sp.set('minPages', String(filters.minPages));
      if (filters.maxPages != null) sp.set('maxPages', String(filters.maxPages));
      if (filters.hasNotes != null) sp.set('hasNotes', String(filters.hasNotes));
      if (filters.noteQuery && filters.noteQuery.trim()) sp.set('noteQuery', filters.noteQuery.trim());
      if (filters.modifiedAfter) sp.set('modifiedAfter', filters.modifiedAfter);
      if (filters.modifiedBefore) sp.set('modifiedBefore', filters.modifiedBefore);
      if (filters.yearFrom != null) sp.set('yearFrom', String(filters.yearFrom));
      if (filters.yearTo != null) sp.set('yearTo', String(filters.yearTo));
      if (filters.hasMetadata != null) sp.set('hasMetadata', String(filters.hasMetadata));
    }
    return fetch(`${API_BASE}/search?${sp.toString()}`).then(handleJson<SearchResultGroup[]>);
  },

  getTags(): Promise<Tag[]> {
    return fetch(`${API_BASE}/tags`).then(handleJson<Tag[]>);
  },

  createTag(name: string, colorHex: string): Promise<Tag> {
    return fetch(`${API_BASE}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, colorHex }),
    }).then(handleJson<Tag>);
  },

  deleteTag(tagId: number): Promise<void> {
    return fetch(`${API_BASE}/tags/${tagId}`, { method: 'DELETE' }).then(() => undefined);
  },

  attachTag(documentId: string, tagId: number): Promise<DocumentItem> {
    return fetch(`${API_BASE}/documents/${documentId}/tags/${tagId}`, { method: 'POST' }).then(
      handleJson<DocumentItem>
    );
  },

  detachTag(documentId: string, tagId: number): Promise<DocumentItem> {
    return fetch(`${API_BASE}/documents/${documentId}/tags/${tagId}`, { method: 'DELETE' }).then(
      handleJson<DocumentItem>
    );
  },

  getDocumentNotes(documentId: string): Promise<ReadingNote[]> {
    return fetch(`${API_BASE}/documents/${documentId}/notes`).then(handleJson<ReadingNote[]>);
  },

  createNote(payload: CreateNotePayload): Promise<ReadingNote> {
    return fetch(`${API_BASE}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(handleJson<ReadingNote>);
  },

  updateNote(id: string, payload: UpdateNotePayload): Promise<ReadingNote> {
    return fetch(`${API_BASE}/notes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(handleJson<ReadingNote>);
  },

  deleteNote(id: string): Promise<void> {
    return fetch(`${API_BASE}/notes/${id}`, { method: 'DELETE' }).then(() => undefined);
  },

  searchNotes(query: string): Promise<ReadingNote[]> {
    const sp = new URLSearchParams({ q: query });
    return fetch(`${API_BASE}/notes?${sp.toString()}`).then(handleJson<ReadingNote[]>);
  },
};

