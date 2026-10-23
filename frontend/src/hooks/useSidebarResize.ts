import { useState, useEffect, useCallback } from 'react';

const SIDEBAR_WIDTH_STORAGE_KEY = 'pdforever.sidebarWidth';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'pdforever.sidebarCollapsed';
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 640;
export const DEFAULT_SIDEBAR_WIDTH = 320;

function loadInitialSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_SIDEBAR_WIDTH;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return DEFAULT_SIDEBAR_WIDTH;
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, parsed));
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function loadInitialSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    return raw !== null ? Boolean(JSON.parse(raw)) : false;
  } catch {
    return false;
  }
}

export function useSidebarResize() {
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadInitialSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(loadInitialSidebarCollapsed);
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);

  // Persist sidebar width
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, JSON.stringify(sidebarWidth));
    } catch {
      // ignore
    }
  }, [sidebarWidth]);

  // Persist collapsed state
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, JSON.stringify(sidebarCollapsed));
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  // Global mousemove / mouseup listeners while dragging the resizer
  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, e.clientX)
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
  }, []);

  const resetSidebarWidth = useCallback(() => {
    setSidebarCollapsed(false);
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  return {
    sidebarWidth,
    sidebarCollapsed,
    isResizingSidebar,
    setSidebarWidth,
    setSidebarCollapsed,
    toggleCollapsed,
    startResizing,
    resetSidebarWidth,
  };
}

