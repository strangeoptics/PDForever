import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { DocumentItem } from '../types';
import { DocumentCard } from './DocumentCard';

export interface VirtualizedDocumentGridProps {
  documents: DocumentItem[];
  coverCacheVersion?: number;
  showCovers: boolean;
  coverLayout: 'top' | 'left' | 'none';
  onClickDocument: (docId: string) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export const VirtualizedDocumentGrid: React.FC<VirtualizedDocumentGridProps> = React.memo(({
  documents,
  coverCacheVersion = 0,
  showCovers,
  coverLayout,
  onClickDocument,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState<number>(3);
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [viewportHeight, setViewportHeight] = useState<number>(800);
  const [gridOffsetTop, setGridOffsetTop] = useState<number>(0);
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null);
  const firstRowRef = useRef<HTMLDivElement | null>(null);

  // Estimate base row height based on layout
  const defaultRowHeight = useMemo(() => {
    if (!showCovers || coverLayout === 'none') return 160;
    if (coverLayout === 'left') return 200;
    return 436; // top layout with large cover image
  }, [showCovers, coverLayout]);

  const rowHeight = measuredRowHeight || defaultRowHeight;

  // Responsive column detection (matching Tailwind breakpoints: <768 = 1, <1280 = 2, >=1280 = 3)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateColumns = () => {
      const width = el.clientWidth;
      if (width < 768) {
        setColumns(1);
      } else if (width < 1280) {
        setColumns(2);
      } else {
        setColumns(3);
      }
    };

    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Measure actual rendered row height once mounted
  useEffect(() => {
    if (firstRowRef.current) {
      const h = firstRowRef.current.offsetHeight;
      if (h > 50 && Math.abs(h + 16 - (measuredRowHeight || 0)) > 10) {
        setMeasuredRowHeight(h + 16);
      }
    }
  }, [columns, coverLayout, showCovers, measuredRowHeight]);

  // Find scroll parent and track scroll position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const scrollParent = (el.closest('.overflow-y-auto') || window) as HTMLElement | Window;

    const handleScroll = () => {
      if (scrollParent instanceof Window) {
        setScrollTop(window.scrollY);
        setViewportHeight(window.innerHeight);
        setGridOffsetTop(el.offsetTop);
      } else {
        setScrollTop(scrollParent.scrollTop);
        setViewportHeight(scrollParent.clientHeight);
        setGridOffsetTop(el.offsetTop);
      }
    };

    handleScroll();
    scrollParent.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      scrollParent.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  const totalRows = Math.ceil(documents.length / Math.max(1, columns));

  // Compute visible rows window with overscan buffer of 2 rows
  const overscan = 2;
  const relativeScrollTop = Math.max(0, scrollTop - gridOffsetTop);

  const startRow = Math.max(0, Math.floor(relativeScrollTop / rowHeight) - overscan);
  const endRow = Math.min(
    totalRows - 1,
    Math.ceil((relativeScrollTop + viewportHeight) / rowHeight) + overscan
  );

  const topSpacerHeight = startRow * rowHeight;
  const bottomSpacerHeight = Math.max(0, (totalRows - 1 - endRow) * rowHeight);

  // Trigger infinite scroll loading if approaching bottom
  useEffect(() => {
    if (hasMore && !isLoadingMore && onLoadMore && endRow >= totalRows - 2) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore, endRow, totalRows]);

  // Group visible rows
  const visibleRows = useMemo(() => {
    if (totalRows === 0 || startRow > endRow) return [];
    const rows = [];
    for (let r = startRow; r <= endRow; r++) {
      const rowDocs = documents.slice(r * columns, (r + 1) * columns);
      rows.push({ rowIndex: r, docs: rowDocs });
    }
    return rows;
  }, [documents, startRow, endRow, columns, totalRows]);

  return (
    <div ref={containerRef} className="w-full">
      {/* Top Virtual Spacer */}
      {topSpacerHeight > 0 && <div style={{ height: `${topSpacerHeight}px` }} />}

      {/* Rendered Visible Rows */}
      <div className="space-y-4">
        {visibleRows.map(({ rowIndex, docs }, idx) => (
          <div
            key={`row-${rowIndex}`}
            ref={idx === 0 ? firstRowRef : undefined}
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
            style={{
              contentVisibility: 'auto',
              containIntrinsicSize: `${rowHeight}px`,
            }}
          >
            {docs.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                coverCacheVersion={coverCacheVersion}
                showCovers={showCovers}
                coverLayout={coverLayout}
                onClick={() => onClickDocument(doc.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Bottom Virtual Spacer */}
      {bottomSpacerHeight > 0 && <div style={{ height: `${bottomSpacerHeight}px` }} />}

      {/* Loading Indicator for Infinite Scroll */}
      {isLoadingMore && (
        <div className="flex justify-center items-center py-6 text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          <span className="text-xs">Lade weitere Dokumente…</span>
        </div>
      )}
    </div>
  );
});

