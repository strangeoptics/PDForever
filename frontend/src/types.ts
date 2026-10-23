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

export interface DocumentItem {
  id: string;
  relativePath: string;
  fileName: string;
  fileSizeBytes: number;
  pageCount: number;
  lastModifiedFs: string;
  createdAt: string;
  tags: Tag[];
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

