import React from 'react';
import { PdfViewer } from './PdfViewer';
import { RightInspector } from './RightInspector';
import {
  AppSettings,
  BoundingBox,
  DocumentItem,
  ReadingNote,
  Tag,
  UpdateMetadataPayload,
  UpdateReadingProgressPayload,
} from '../types';

interface ReaderWorkspaceProps {
  activeDoc: DocumentItem;
  docNotes: ReadingNote[];
  targetJump: { page: number; noteId?: string; timestamp: number } | null;
  inspectorOpen: boolean;
  settings: AppSettings;
  splitViewOpen: boolean;
  secondaryDoc: DocumentItem | null;
  secondaryDocNotes: ReadingNote[];
  secondaryTargetJump: { page: number; noteId?: string; timestamp: number } | null;
  availableDocuments: DocumentItem[];
  tags: Tag[];
  enrichingDoc: boolean;
  onToggleInspector: () => void;
  onToggleSplitView: () => void;
  onCloseSecondaryPane: () => void;
  onChangeSecondaryDocument: (docId: string) => void;
  onUpdateReadingProgress: (docId: string, payload: UpdateReadingProgressPayload) => void;
  onPageChange: (page: number) => void;
  onRequestCreateNote: (selection: {
    documentId: string;
    pageNumber: number;
    selectedText: string;
    boundingBox: BoundingBox;
  }) => void;
  onSelectPrimaryNote: (note: ReadingNote) => void;
  onSelectSecondaryNote: (note: ReadingNote) => void;
  onEnrichActiveDoc: () => void;
  onSaveMetadata: (metadata: UpdateMetadataPayload) => Promise<void>;
  onToggleDocTag: (tag: Tag) => void;
  onOpenNewNoteModal: (pageNumber: number) => void;
  onEditNote: (note: ReadingNote) => void;
  onDeleteNote: (noteId: string) => void;
}

export const ReaderWorkspace: React.FC<ReaderWorkspaceProps> = ({
  activeDoc,
  docNotes,
  targetJump,
  inspectorOpen,
  settings,
  splitViewOpen,
  secondaryDoc,
  secondaryDocNotes,
  secondaryTargetJump,
  availableDocuments,
  tags,
  enrichingDoc,
  onToggleInspector,
  onToggleSplitView,
  onCloseSecondaryPane,
  onChangeSecondaryDocument,
  onUpdateReadingProgress,
  onPageChange,
  onRequestCreateNote,
  onSelectPrimaryNote,
  onSelectSecondaryNote,
  onEnrichActiveDoc,
  onSaveMetadata,
  onToggleDocTag,
  onOpenNewNoteModal,
  onEditNote,
  onDeleteNote,
}) => {
  return (
    <>
      {/* Reader Area: Single or Side-by-Side Split-View */}
      <div className="flex-1 flex min-w-0 h-full divide-x divide-slate-200 dark:divide-slate-800">
        {/* Primary PDF Viewer */}
        <div className="flex-1 min-w-0 h-full">
          <PdfViewer
            document={activeDoc}
            notes={docNotes}
            targetJump={targetJump}
            inspectorOpen={inspectorOpen}
            defaultViewMode={settings.defaultViewMode}
            isSplitView={splitViewOpen}
            isSecondaryPane={false}
            onToggleInspector={onToggleInspector}
            onToggleSplitView={onToggleSplitView}
            onUpdateProgress={onUpdateReadingProgress}
            onPageChange={onPageChange}
            onRequestCreateNote={onRequestCreateNote}
            onSelectNote={onSelectPrimaryNote}
          />
        </div>

        {/* Secondary PDF Viewer (Split-View Mode) */}
        {splitViewOpen && secondaryDoc && (
          <div className="flex-1 min-w-0 h-full">
            <PdfViewer
              document={secondaryDoc}
              notes={secondaryDocNotes}
              targetJump={secondaryTargetJump}
              inspectorOpen={inspectorOpen}
              defaultViewMode={settings.defaultViewMode}
              isSplitView={true}
              isSecondaryPane={true}
              availableDocuments={availableDocuments}
              onCloseSecondaryPane={onCloseSecondaryPane}
              onChangeSecondaryDocument={onChangeSecondaryDocument}
              onUpdateProgress={onUpdateReadingProgress}
              onRequestCreateNote={onRequestCreateNote}
              onSelectNote={onSelectSecondaryNote}
            />
          </div>
        )}
      </div>

      {/* Right Split-Pane Inspector: Reading Status, Document Tags & Reading Notes (Lesezettel) */}
      {inspectorOpen && (
        <RightInspector
          activeDoc={activeDoc}
          tags={tags}
          docNotes={docNotes}
          enrichingDoc={enrichingDoc}
          onUpdateReadingProgress={onUpdateReadingProgress}
          onEnrichActiveDoc={onEnrichActiveDoc}
          onSaveMetadata={onSaveMetadata}
          onToggleDocTag={onToggleDocTag}
          onOpenNewNoteModal={onOpenNewNoteModal}
          onEditNote={onEditNote}
          onDeleteNote={onDeleteNote}
          onSelectNote={onSelectPrimaryNote}
        />
      )}
    </>
  );
};

