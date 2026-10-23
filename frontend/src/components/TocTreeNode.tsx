import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { TocItem } from '../types';

export function countTocItems(items: TocItem[]): number {
  return items.reduce((acc, item) => acc + 1 + countTocItems(item.children || []), 0);
}

export function findActiveTocPage(items: TocItem[], currentPage: number): number | null {
  let bestPage: number | null = null;
  const traverse = (nodes: TocItem[]) => {
    for (const node of nodes) {
      if (node.pageNumber !== null && node.pageNumber <= currentPage) {
        if (bestPage === null || node.pageNumber >= bestPage) {
          bestPage = node.pageNumber;
        }
      }
      if (node.children?.length) {
        traverse(node.children);
      }
    }
  };
  traverse(items);
  return bestPage;
}

export interface TocTreeNodeProps {
  item: TocItem;
  level: number;
  filterQuery: string;
  activeTocPage: number | null;
  onSelectPage: (page: number) => void;
}

export const TocTreeNode: React.FC<TocTreeNodeProps> = ({
  item,
  level,
  filterQuery,
  activeTocPage,
  onSelectPage,
}) => {
  const [expanded, setExpanded] = useState<boolean>(level < 2);
  const hasChildren = Boolean(item.children && item.children.length > 0);

  const matchesFilter = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return true;
    const check = (node: TocItem): boolean => {
      if (node.title.toLowerCase().includes(q)) return true;
      return (node.children || []).some(check);
    };
    return check(item);
  }, [item, filterQuery]);

  if (!matchesFilter) return null;

  const isActive = item.pageNumber !== null && item.pageNumber === activeTocPage;
  const isExpanded = filterQuery.trim() ? true : expanded;

  return (
    <div>
      <div
        style={{ paddingLeft: `${level * 12 + 6}px` }}
        className={`flex items-center justify-between gap-1.5 pr-2 py-1.5 rounded-lg text-xs transition ${
          isActive
            ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-300'
        }`}
      >
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((prev) => !prev);
              }}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          <button
            type="button"
            onClick={() => item.pageNumber && onSelectPage(item.pageNumber)}
            disabled={!item.pageNumber}
            className="flex-1 text-left truncate disabled:opacity-60"
            title={item.title}
          >
            {item.title}
          </button>
        </div>

        {item.pageNumber !== null && (
          <button
            type="button"
            onClick={() => onSelectPage(item.pageNumber!)}
            className="shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-blue-500"
          >
            {item.pageNumber}
          </button>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-0.5 mt-0.5">
          {item.children.map((child, idx) => (
            <TocTreeNode
              key={`${child.title}-${idx}`}
              item={child}
              level={level + 1}
              filterQuery={filterQuery}
              activeTocPage={activeTocPage}
              onSelectPage={onSelectPage}
            />
          ))}
        </div>
      )}
    </div>
  );
};

