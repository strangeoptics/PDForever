import {
  CreateNotePayload,
  DocumentFacets,
  DocumentFilterParams,
  DocumentItem,
  EpubChapterItem,
  MetadataEnrichmentReport,
  OllamaStatus,
  PaginatedResponse,
  RagPassage,
  RagQueryPayload,
  RagResponse,
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
    return fetch(`${API_BASE}/documents?${sp.toString()}`)
      .then(handleJson<any>)
      .then((res: any) => {
        if (res && res.page) {
          return {
            content: res.content ?? [],
            totalElements: res.page.totalElements ?? 0,
            totalPages: res.page.totalPages ?? 0,
            number: res.page.number ?? 0,
            size: res.page.size ?? 0,
          };
        }
        return res as PaginatedResponse<DocumentItem>;
      });
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

  getEpubChapters(id: string): Promise<EpubChapterItem[]> {
    return fetch(`${API_BASE}/documents/${id}/epub/chapters`).then(handleJson<EpubChapterItem[]>);
  },

  getEpubChapterHtml(id: string, index = 1): Promise<string> {
    return fetch(`${API_BASE}/documents/${id}/epub/chapter?index=${index}`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load EPUB chapter: ${res.status}`);
      return res.text();
    });
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

  getRagStatus(ollamaUrl?: string): Promise<OllamaStatus> {
    const sp = new URLSearchParams();
    if (ollamaUrl) sp.set('ollamaUrl', ollamaUrl);
    const qs = sp.toString();
    return fetch(`${API_BASE}/rag/status${qs ? `?${qs}` : ''}`).then(handleJson<OllamaStatus>);
  },

  askRag(payload: RagQueryPayload): Promise<RagResponse> {
    return fetch(`${API_BASE}/rag/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(handleJson<RagResponse>);
  },

  streamRag(
    payload: RagQueryPayload,
    onPassages: (passages: RagPassage[]) => void,
    onToken: (token: string) => void,
    onError: (error: string) => void,
    onDone: () => void,
    signal?: AbortSignal
  ): void {
    fetch(`${API_BASE}/rag/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
      .then(async (response) => {
        if (!response.ok || !response.body) {
          const errText = await response.text().catch(() => response.statusText);
          onError(`HTTP ${response.status}: ${errText}`);
          onDone();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let currentEvent = 'message';
        let currentData: string[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, '');
            if (line === '') {
              if (currentData.length > 0 || currentEvent === 'done') {
                const fullData = currentData.join('\n');
                if (currentEvent === 'passages') {
                  try {
                    const parsed: RagPassage[] = JSON.parse(fullData);
                    onPassages(parsed);
                  } catch (e) {
                    console.error('Failed to parse RAG passages SSE:', e);
                  }
                } else if (currentEvent === 'token') {
                  try {
                    const parsed = JSON.parse(fullData);
                    const tokenStr = typeof parsed === 'string' ? parsed : (parsed.token ?? parsed.text ?? '');
                    onToken(tokenStr);
                  } catch {
                    onToken(fullData);
                  }
                } else if (currentEvent === 'error') {
                  try {
                    const parsed = JSON.parse(fullData);
                    onError(typeof parsed === 'string' ? parsed : (parsed.error ?? fullData));
                  } catch {
                    onError(fullData);
                  }
                } else if (currentEvent === 'done') {
                  onDone();
                  return;
                }
              }
              currentEvent = 'message';
              currentData = [];
            } else if (line.startsWith('event:')) {
              currentEvent = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
              let dataContent = line.substring(5);
              if (dataContent.startsWith(' {') || dataContent.startsWith(' [')) {
                dataContent = dataContent.trimStart();
              }
              currentData.push(dataContent);
            }
          }
        }
        onDone();
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          onError(err.message || 'Verbindung zu Ollama fehlgeschlagen');
        }
        onDone();
      });
  },
};

