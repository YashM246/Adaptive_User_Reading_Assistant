import { useMemo, type RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DocumentStructure, Rect, TextSpan } from '../types/aura';
import { PageView } from './PageView';

export interface PdfDocumentViewProps {
  pdf: PDFDocumentProxy;
  structure: DocumentStructure;
  highlights: TextSpan[];
  selectedId: string | null;
  onHighlightClick: (span: TextSpan) => void;
  onTextSelect?: (text: string, pageIndex: number, rect: Rect) => void;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  zoom?: number;
}

export function PdfDocumentView({
  pdf,
  structure,
  highlights,
  selectedId,
  onHighlightClick,
  onTextSelect,
  scrollRootRef,
  zoom = 1,
}: PdfDocumentViewProps) {
  const pages = useMemo(
    () => Array.from({ length: structure.numPages }, (_, i) => i),
    [structure.numPages]
  );

  return (
    <div className="pdf-document-stack">
      <div
        className="pdf-zoom-wrapper"
        style={{ zoom }}
      >
        {pages.map((pageIndex) => (
          <PageView
            key={pageIndex}
            pdf={pdf}
            pageIndex={pageIndex}
            scale={structure.scale}
            structure={structure}
            highlights={highlights}
            selectedId={selectedId}
            onHighlightClick={onHighlightClick}
            onTextSelect={onTextSelect}
            scrollRootRef={scrollRootRef}
          />
        ))}
      </div>
    </div>
  );
}
