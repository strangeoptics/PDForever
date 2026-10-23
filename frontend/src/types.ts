export interface TreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  documentId: string | null;
  pageCount: number | null;
  children: TreeNode[];
}

export interface Tag {
  id: number;
  name: string;
  colorHex: string;
}

export type ReadingStatus = 'UNREAD' | 'READING' | 'COMPLETED';

export type ReaderViewMode = 'continuous' | 'single' | 'spread' | 'book';

export interface TocItem {
  title: string;
  pageNumber: number | null;
  children: TocItem[];
}

export interface UpdateReadingProgressPayload {
  lastReadPage?: number;
  readingStatus?: ReadingStatus;
}

export interface DocumentItem {
  id: string;
  relativePath: string;
  fileName: string;
  fileSizeBytes: number;
  pageCount: number;
  lastModifiedFs: string;
  createdAt: string;
  tags: Tag[];
  readingStatus: ReadingStatus;
  lastReadPage: number;
  lastOpenedAt: string | null;
}

export interface PaginatedResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ReadingNote {
  id: string;
  documentId: string;
  documentTitle: string;
  relativePath: string;
  pageNumber: number;
  selectedText: string;
  noteMarkdown: string;
  boundingBox: BoundingBox;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNotePayload {
  documentId: string;
  pageNumber: number;
  selectedText: string;
  noteMarkdown: string;
  boundingBox: BoundingBox;
}

export interface UpdateNotePayload {
  selectedText?: string;
  noteMarkdown: string;
  boundingBox?: BoundingBox;
}

export interface SearchPageMatch {
  pageNumber: number;
  snippetHtml: string;
  score: number;
}

export interface SearchResultGroup {
  docId: string;
  title: string;
  relPath: string;
  matches: SearchPageMatch[];
}

export interface AppSettings {
  showCovers: boolean;
  coverLayout: 'left' | 'top';
  defaultViewMode: ReaderViewMode;
  defaultInspectorOpen: boolean;
}


