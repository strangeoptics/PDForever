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

export interface UpdateMetadataPayload {
  doi?: string;
  isbn?: string;
  metaTitle?: string;
  authors?: string;
  publicationYear?: number | null;
  abstractText?: string;
}

export interface MetadataEnrichmentReport {
  scanned: number;
  identifiersDetected: number;
  enriched: number;
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
  doi?: string | null;
  isbn?: string | null;
  metaTitle?: string | null;
  authors?: string | null;
  publicationYear?: number | null;
  abstractText?: string | null;
  metadataSource?: string | null;
  metadataEnrichedAt?: string | null;
  noteCount?: number;
}

export function formatDocTitle(doc: { metaTitle?: string | null; fileName: string }): string {
  const title = doc.metaTitle?.trim();
  if (title) return title;
  return doc.fileName.replace(/\.pdf$/i, '');
}

export interface DocumentFilterParams {
  path?: string;
  tag?: string;
  status?: string;
  minPages?: number | null;
  maxPages?: number | null;
  hasNotes?: boolean | null;
  noteQuery?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  hasMetadata?: boolean | null;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  size?: number;
}

export interface TagFacet {
  id: number;
  name: string;
  colorHex: string;
  documentCount: number;
}

export interface DocumentFacets {
  totalDocuments: number;
  unreadCount: number;
  readingCount: number;
  completedCount: number;
  withNotesCount: number;
  totalNotesCount: number;
  withMetadataCount: number;
  shortDocsCount: number;
  mediumDocsCount: number;
  longDocsCount: number;
  minPageCount: number;
  maxPageCount: number;
  minPublicationYear: number | null;
  maxPublicationYear: number | null;
  tags: TagFacet[];
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
  ragModel?: string;
  customOllamaUrl?: string;
}

export interface RagPassage {
  documentId: string;
  documentTitle: string;
  relativePath: string;
  pageNumber: number;
  passageText: string;
  score: number;
}

export interface RagResponse {
  answer: string | null;
  passages: RagPassage[];
  model: string;
  ollamaAvailable: boolean;
  errorMessage?: string | null;
}

export interface OllamaStatus {
  enabled: boolean;
  available: boolean;
  ollamaUrl: string;
  currentModel: string;
  installedModels: string[];
  message: string;
}

export interface RagQueryPayload {
  query: string;
  documentId?: string | null;
  criteria?: DocumentFilterParams;
  model?: string;
}



