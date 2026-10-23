import React from 'react';
import { BookmarkPlus } from 'lucide-react';
import { BoundingBox } from '../types';

export interface FloatingSelectionData {
  pageNumber: number;
  selectedText: string;
  boundingBox: BoundingBox;
  screenX: number;
  screenY: number;
}

interface FloatingSelectionButtonProps {
  data: FloatingSelectionData | null;
  onAddNote: (noteData: {
    pageNumber: number;
    selectedText: string;
    boundingBox: BoundingBox;
  }) => void;
  onClear: () => void;
}

export const FloatingSelectionButton: React.FC<FloatingSelectionButtonProps> = ({
  data,
  onAddNote,
  onClear,
}) => {
  if (!data) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: `${data.screenX}px`,
        top: `${data.screenY}px`,
        transform: 'translate(-50%, -100%)',
      }}
      className="z-50 animate-in fade-in zoom-in-95 duration-100"
    >
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAddNote({
            pageNumber: data.pageNumber,
            selectedText: data.selectedText,
            boundingBox: data.boundingBox,
          });
          window.getSelection()?.removeAllRanges();
          onClear();
        }}
        className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 font-semibold text-xs shadow-xl ring-2 ring-white/20 hover:scale-105 transition cursor-pointer"
      >
        <BookmarkPlus className="w-4 h-4" />
        Add Reading Note
      </button>
    </div>
  );
};

