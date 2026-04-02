import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DocumentStructure, Rect, TextSpan } from '../types/aura';

export interface PageViewProps {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  structure: DocumentStructure;
  highlights: TextSpan[];
  selectedId: string | null;
  onHighlightClick: (span: TextSpan) => void;
  onTextSelect?: (text: string, pageIndex: number, rect: Rect) => void;
  scrollRootRef?: React.RefObject<HTMLElement | null>;
}

export function PageView({
  pdf,
  pageIndex,
  scale,
  structure,
  highlights,
  selectedId,
  onHighlightClick,
  onTextSelect,
  scrollRootRef,
}: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(pageIndex === 0);

  useEffect(() => {
    if (shouldRender) return;
    const el = wrapRef.current;
    const root = scrollRootRef?.current ?? null;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShouldRender(true);
        }
      },
      { root, rootMargin: '400px 0px', threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shouldRender, scrollRootRef]);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    void (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      const task = page.render({ canvasContext: ctx, viewport, canvas });
      await task.promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageIndex, scale, shouldRender]);

  useEffect(() => {
    if (!onTextSelect || !shouldRender) return;
    const layer = textLayerRef.current;
    if (!layer) return;

    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const text = sel.toString().trim();
      if (!text || text.length < 3) return;

      const range = sel.getRangeAt(0);
      const domRect = range.getBoundingClientRect();

      const rect: Rect = {
        x: domRect.left,
        y: domRect.top,
        width: domRect.width,
        height: domRect.height,
      };

      onTextSelect(text, pageIndex, rect);
    };

    layer.addEventListener('mouseup', handleMouseUp);
    return () => layer.removeEventListener('mouseup', handleMouseUp);
  }, [onTextSelect, pageIndex, shouldRender]);

  const pageData = structure.pages[pageIndex];
  const pageHighlights = highlights.filter((h) => h.pageIndex === pageIndex);

  if (!pageData) return null;

  if (!shouldRender) {
    return (
      <div
        ref={wrapRef}
        className="page-wrap page-placeholder"
        data-page={pageIndex}
        style={{
          height: pageData.viewportHeight + 16,
          marginBottom: 16,
          background: '#F2F1EC',
          borderRadius: 8,
        }}
        aria-hidden
      />
    );
  }

  return (
    <div
      ref={wrapRef}
      className="page-wrap"
      data-page={pageIndex}
      style={{
        position: 'relative',
        marginBottom: 16,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        overflow: 'hidden',
        width: pageData.viewportWidth,
      }}
    >
      <canvas ref={canvasRef} className="page-canvas" />

      {/* Transparent text layer for selection */}
      <div
        ref={textLayerRef}
        className="text-select-layer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: pageData.viewportWidth,
          height: pageData.viewportHeight,
          pointerEvents: 'auto',
        }}
      >
        {pageData.items.map((it, i) => (
          <span
            key={i}
            className="text-select-span"
            style={{
              position: 'absolute',
              left: it.rect.x,
              top: it.rect.y,
              height: it.rect.height,
              fontSize: `${Math.max(it.rect.height, 8)}px`,
              lineHeight: `${it.rect.height}px`,
              userSelect: 'text',
              color: 'transparent',
            }}
          >
            {it.text}
          </span>
        ))}
      </div>

      {/* Per-line highlight rects */}
      <div
        className="highlight-layer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: pageData.viewportWidth,
          height: pageData.viewportHeight,
          pointerEvents: 'none',
        }}
      >
        {pageHighlights.map((h) =>
          h.rects.map((rect, ri) => {
            const clipLeft = Math.max(0, rect.x);
            const clipRight = Math.min(pageData.viewportWidth, rect.x + rect.width);
            if (clipRight <= clipLeft) {
              return null;
            }
            const clampedWidth = Math.max(4, clipRight - clipLeft);
            return (
              <button
                key={`${h.id}-${ri}`}
                type="button"
                className={`hl ${selectedId === h.id ? 'active' : ''}`}
                style={{
                  position: 'absolute',
                  left: clipLeft,
                  top: rect.y,
                  width: clampedWidth,
                  height: Math.max(rect.height, 4),
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                }}
                aria-label="Highlighted passage"
                onClick={() => onHighlightClick(h)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
