import React, { useEffect, useRef, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { DocumentItem } from '../types';
import { api } from '../api';

const fallbackCoverCache = new Map<string, string>();

interface DocumentCoverProps {
  document: DocumentItem;
  className?: string;
}

export const DocumentCover: React.FC<DocumentCoverProps> = ({ document: doc, className = '' }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [backendFailed, setBackendFailed] = useState<boolean>(false);
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [fallbackDataUrl, setFallbackDataUrl] = useState<string | null>(
    () => fallbackCoverCache.get(doc.id) || null
  );
  const [fallbackFailed, setFallbackFailed] = useState<boolean>(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '250px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Client-side PDF.js fallback ONLY if backend cover endpoint fails or is unavailable
  useEffect(() => {
    if (!isVisible || !backendFailed || fallbackDataUrl || fallbackFailed) return;

    const cached = fallbackCoverCache.get(doc.id);
    if (cached) {
      setFallbackDataUrl(cached);
      return;
    }

    let cancelled = false;
    let loadingTaskRef: { destroy: () => void } | null = null;

    import('pdfjs-dist').then(async (pdfjsLib) => {
      if (cancelled) return;

      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();

      const streamUrl = api.getStreamUrl(doc.id);
      const loadingTask = pdfjsLib.getDocument({
        url: streamUrl,
        rangeChunkSize: 256 * 1024,
        disableAutoFetch: true,
        disableStream: false,
      });
      loadingTaskRef = loadingTask;

      try {
        const pdf = await loadingTask.promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        try {
          const page = await pdf.getPage(1);
          const unscaled = page.getViewport({ scale: 1 });
          const targetWidth = 320;
          const scale = unscaled.width > 0 ? targetWidth / unscaled.width : 0.5;
          const viewport = page.getViewport({ scale });

          const canvas = window.document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('No 2d context');

          await page.render({ canvasContext: ctx, viewport }).promise;
          if (!cancelled) {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            fallbackCoverCache.set(doc.id, dataUrl);
            setFallbackDataUrl(dataUrl);
            setImageLoaded(true);
          }
        } finally {
          pdf.destroy();
        }
      } catch {
        if (!cancelled) {
          setFallbackFailed(true);
        }
      }
    });

    return () => {
      cancelled = true;
      if (loadingTaskRef) {
        loadingTaskRef.destroy();
      }
    };
  }, [isVisible, backendFailed, fallbackDataUrl, fallbackFailed, doc.id]);

  const coverUrl = api.getCoverUrl(doc.id, doc.lastModifiedFs);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center select-none ${className}`}
    >
      {/* 1. Try backend cached JPEG thumbnail first */}
      {isVisible && !backendFailed && (
        <img
          src={coverUrl}
          alt={doc.fileName}
          loading="lazy"
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          onError={() => setBackendFailed(true)}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* 2. Client-side PDF.js fallback if backend failed */}
      {isVisible && backendFailed && fallbackDataUrl && !fallbackFailed && (
        <img
          src={fallbackDataUrl}
          alt={doc.fileName}
          className="w-full h-full object-cover animate-in fade-in duration-200"
        />
      )}

      {/* Placeholder / Spinner while loading */}
      {isVisible && !imageLoaded && !fallbackFailed && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100/80 dark:bg-slate-800/80">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      )}

      {/* 3. Generic fallback icon if both backend & client rendering failed */}
      {(!isVisible || fallbackFailed || (backendFailed && !fallbackDataUrl && !imageLoaded)) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1 p-2 text-center">
          <FileText className="w-8 h-8 stroke-1" />
          <span className="text-[10px] font-mono line-clamp-1">{doc.fileName}</span>
        </div>
      )}
    </div>
  );
};
