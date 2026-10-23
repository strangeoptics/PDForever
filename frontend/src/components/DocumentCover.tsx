import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { FileText, Loader2 } from 'lucide-react';
import { DocumentItem } from '../types';
import { api } from '../api';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

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

  // Client-side PDF.js fallback if backend cover endpoint fails or is unavailable
  useEffect(() => {
    if (!isVisible || !backendFailed || fallbackDataUrl || fallbackFailed) return;

    const cached = fallbackCoverCache.get(doc.id);
    if (cached) {
      setFallbackDataUrl(cached);
      return;
    }

    let cancelled = false;
    const streamUrl = api.getStreamUrl(doc.id);
    const loadingTask = pdfjsLib.getDocument({
      url: streamUrl,
      rangeChunkSize: 256 * 1024,
      disableAutoFetch: true,
      disableStream: false,
    });

    loadingTask.promise
      .then(async (pdf) => {
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
      })
      .catch(() => {
        if (!cancelled) {
          setFallbackFailed(true);
        }
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [isVisible, backendFailed, fallbackDataUrl, fallbackFailed, doc.id]);

  const coverUrl = api.getCoverUrl(doc.id, doc.lastModifiedFs);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center select-none ${className}`}
    >
      {/* Loading / Fallback Placeholder */}
      {(!imageLoaded || (backendFailed && fallbackFailed)) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-slate-400 dark:text-slate-500 p-2">
          {isVisible && !fallbackFailed ? (
            <Loader2 className="w-5 h-5 animate-spin text-blue-500/70" />
          ) : (
            <FileText className="w-7 h-7 stroke-1" />
          )}
        </div>
      )}

      {/* Primary: Backend rendered & cached cover image */}
      {isVisible && !backendFailed && (
        <img
          src={coverUrl}
          alt={`Cover of ${doc.fileName}`}
          loading="lazy"
          onLoad={() => setImageLoaded(true)}
          onError={() => setBackendFailed(true)}
          className={`w-full h-full object-cover object-top transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Secondary Fallback: PDF.js rendered cover image */}
      {isVisible && backendFailed && fallbackDataUrl && (
        <img
          src={fallbackDataUrl}
          alt={`Cover of ${doc.fileName}`}
          className="w-full h-full object-cover object-top transition-opacity duration-300 opacity-100"
        />
      )}
    </div>
  );
};

