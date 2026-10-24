import { useEffect, useRef, useCallback } from 'react';

export interface ParsedUrlState {
  docId: string | null;
  page: number | null;
  splitDocId: string | null;
  folder: string | null;
  tag: string | null;
  status: string | null;
  format: string | null;
  tab: 'folders' | 'outline' | 'tags' | 'notes' | 'rag' | null;
  noteId: string | null;
}

export function parseUrlState(): ParsedUrlState {
  if (typeof window === 'undefined') {
    return {
      docId: null,
      page: null,
      splitDocId: null,
      folder: null,
      tag: null,
      status: null,
      format: null,
      tab: null,
      noteId: null,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const docId = params.get('doc');
  const pageStr = params.get('page');
  const page = pageStr ? parseInt(pageStr, 10) : null;
  const splitDocId = params.get('split');
  const folder = params.get('folder');
  const tag = params.get('tag');
  const status = params.get('status');
  const format = params.get('format');
  const tabRaw = params.get('tab');
  const validTabs: Array<'folders' | 'outline' | 'tags' | 'notes' | 'rag'> = [
    'folders',
    'outline',
    'tags',
    'notes',
    'rag',
  ];
  const tab = validTabs.includes(tabRaw as any)
    ? (tabRaw as 'folders' | 'outline' | 'tags' | 'notes' | 'rag')
    : null;
  const noteId = params.get('note');

  return {
    docId,
    page: page && !Number.isNaN(page) && page > 0 ? page : null,
    splitDocId,
    folder,
    tag,
    status,
    format,
    tab,
    noteId,
  };
}

export interface UrlSyncParams {
  docId: string | null;
  page: number;
  splitDocId?: string | null;
  folder: string;
  tag: string;
  status: string;
  format?: string;
  tab: 'folders' | 'outline' | 'tags' | 'notes' | 'rag';
  noteId?: string | null;
}

export function useUrlState({
  onPopStateNavigation,
}: {
  onPopStateNavigation: (parsed: ParsedUrlState) => void;
}) {
  const lastDocIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen to browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseUrlState();
      lastDocIdRef.current = parsed.docId;
      onPopStateNavigation(parsed);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [onPopStateNavigation]);

  const syncUrl = useCallback(
    ({ docId, page, splitDocId, folder, tag, status, format, tab, noteId }: UrlSyncParams) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // Debounce slightly (80ms) so fast scrolling doesn't spam history API
      timerRef.current = setTimeout(() => {
        const sp = new URLSearchParams();

        if (docId) {
          sp.set('doc', docId);
          if (page && page > 1) {
            sp.set('page', String(page));
          }
          if (splitDocId) {
            sp.set('split', splitDocId);
          }
          if (noteId) {
            sp.set('note', noteId);
          }
        } else {
          if (folder) sp.set('folder', folder);
          if (tag) sp.set('tag', tag);
          if (status) sp.set('status', status);
          if (format) sp.set('format', format);
        }

        if (tab && tab !== 'folders') {
          sp.set('tab', tab);
        }

        const search = sp.toString();
        const newUrl = search ? `${window.location.pathname}?${search}` : window.location.pathname;
        const currentSearch = window.location.search.replace(/^\?/, '');

        if (currentSearch !== search) {
          // If switching between documents or going between library and document: pushState
          const isDocTransition = docId !== lastDocIdRef.current;
          lastDocIdRef.current = docId;

          if (isDocTransition) {
            window.history.pushState({ docId, page }, '', newUrl);
          } else {
            // If just flipping pages or tweaking filters: replaceState (no history spam)
            window.history.replaceState({ docId, page }, '', newUrl);
          }
        }
      }, 80);
    },
    []
  );

  return { syncUrl };
}

