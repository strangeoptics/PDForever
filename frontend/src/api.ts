import {
  CreateNotePayload,
  DocumentItem,
  PaginatedResponse,
  ReadingNote,
  SearchResultGroup,
  Tag,
  TreeNode,
  UpdateNotePayload,
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

  getDocuments(params: { path?: string; tag?: string; page?: number; size?: number }): Promise<PaginatedResponse<DocumentItem>> {
    const sp = new URLSearchParams();
    if (params.path) sp.set('path', params.path);
    if (params.tag) sp.set('tag', params.tag);
    sp.set('page', String(params.page ?? 0));
    sp.set('size', String(params.size ?? 50));
    return fetch(`${API_BASE}/documents?${sp.toString()}`).then(handleJson<PaginatedResponse<DocumentItem>>);
  },

  getDocument(id: string): Promise<DocumentItem> {
    return fetch(`${API_BASE}/documents/${id}`).then(handleJson<DocumentItem>);
  },

  getStreamUrl(id: string): string {
    return `${API_BASE}/documents/${id}/stream`;
  },

  searchLucene(query: string): Promise<SearchResultGroup[]> {
    const sp = new URLSearchParams({ q: query });
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

