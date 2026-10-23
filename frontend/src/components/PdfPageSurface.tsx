import React, { useRef, useState, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ReadingNote } from '../types';

export interface PdfPageSurfaceProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  defaultPageSize: { width: number; height: number };
  pageNotes: ReadingNote[];
  highlightedNoteId: string | null;
  forceVisible?: boolean;
  onSelectNote: (note: ReadingNote) => void;
  registerPageEl: (el: HTMLDivElement | null) => void;
}

export const PdfPageSurface: React.FC<PdfPageSurfaceProps> = ({
  pdfDoc,
  pageNumber,
  scale,
  defaultPageSize,
  pageNotes,
  highlightedNoteId,
  forceVisible = false,
  onSelectNote,
  registerPageEl,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(forceVisible || pageNumber <= 3);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: Math.floor(defaultPageSize.width * scale),
    height: Math.floor(defaultPageSize.height * scale),
  });

  useEffect(() => {
    if (forceVisible) {
      setIsVisible(true);
    }
  }, [forceVisible]);

  useEffect(() => {
    if (!isVisible) {
      setDimensions({
        width: Math.floor(defaultPageSize.width * scale),
        height: Math.floor(defaultPageSize.height * scale),
      });
    }
  }, [defaultPageSize, scale, isVisible]);

  // Lazy-render pages via IntersectionObserver so 500+ page books stay fast & low-memory
  useEffect(() => {
    if (forceVisible) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
          }
        }
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [forceVisible]);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    let textLayerInstance: pdfjsLib.TextLayer | null = null;

    pdfDoc
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        setDimensions({
          width: Math.floor(viewport.width),
          height: Math.floor(viewport.height),
        });

        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;
        if (!canvas || !textLayerDiv) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        renderTask = page.render({
          canvasContext: ctx,
          viewport,
        });
        await renderTask.promise;

        if (cancelled) return;

        // Render selectable PDF.js TextLayer
        textLayerDiv.innerHTML = '';
        textLayerDiv.style.setProperty('--scale-factor', String(viewport.scale));
        textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
        textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;

        const textContent = await page.getTextContent();
        if (cancelled) return;

        textLayerInstance = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayerInstance.render();
      })
      .catch(() => {
        // Ignore cancelled render task errors
      });

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
      if (textLayerInstance) {
        textLayerInstance.cancel();
      }
    };
  }, [pdfDoc, pageNumber, scale, isVisible]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        registerPageEl(el);
      }}
      data-page-number={pageNumber}
      style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px` }}
      className="pdf-page-container relative bg-white shadow-lg ring-1 ring-slate-300 dark:ring-slate-800 rounded-xs shrink-0"
    >
      <canvas ref={canvasRef} className="block pointer-events-none" />

      {/* Visual Highlight Overlays for ReadingNotes (Normalized 0.0 - 1.0 coordinates) */}
      <div className="absolute inset-0 pointer-events-none z-20">
        {pageNotes.map((note) => {
          const { x1, y1, x2, y2 } = note.boundingBox;
          const left = `${Math.max(0, Math.min(98, x1 * 100))}%`;
          const top = `${Math.max(0, Math.min(98, y1 * 100))}%`;
          const width = `${Math.max(3, Math.min(100 - x1 * 100, (x2 - x1) * 100))}%`;
          const height = `${Math.max(1.8, Math.min(100 - y1 * 100, (y2 - y1) * 100))}%`;
          const isPulse = highlightedNoteId === note.id;

          return (
            <div
              key={note.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectNote(note);
              }}
              style={{ left, top, width, height }}
              title={`${note.noteMarkdown}\n(Click to view note)`}
              className={`pointer-events-auto absolute cursor-pointer rounded-xs transition-all duration-300 ${
                isPulse
                  ? 'bg-amber-400/60 ring-4 ring-amber-500 shadow-lg scale-[1.02]'
                  : 'bg-amber-300/35 hover:bg-amber-400/50 border-b-2 border-amber-500/80'
              }`}
            />
          );
        })}
      </div>

      {/* Selectable PDF.js TextLayer */}
      <div ref={textLayerRef} className="textLayer" />

      {/* Subtle Page Number Footer Badge */}
      <div className="absolute bottom-2 right-3 z-30 pointer-events-none px-2 py-0.5 rounded bg-slate-900/65 text-[11px] font-mono text-white">
        p. {pageNumber}
      </div>
    </div>
  );
};

