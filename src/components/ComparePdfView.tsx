import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import * as pdfjsLib from 'pdfjs-dist';
import { PdfDocumentView } from './PdfDocumentView';
import { extractPdfStructure } from '../lib/structure/extractPdfStructure';
import { api } from '../lib/api/client';
import type { DocumentStructure } from '../types/aura';
import type { CompareResponse } from '../lib/api/client';

type Side = 'left' | 'right';

interface SideState {
  fileName: string;
  pdf: PDFDocumentProxy | null;
  structure: DocumentStructure | null;
  docId: string | null;
  loadState: 'idle' | 'loading' | 'error';
  loadError: string | null;
}

const emptySide = (): SideState => ({
  fileName: '',
  pdf: null,
  structure: null,
  docId: null,
  loadState: 'idle',
  loadError: null,
});

export interface ReaderCompareSeed {
  pdf: PDFDocumentProxy;
  structure: DocumentStructure;
  fileName: string;
  docId: string | null;
}

export interface ComparePdfViewProps {
  aiEnabled: boolean;
  /** When set (e.g. Reader had a PDF open), left pane is filled without re-parsing. */
  initialLeftFromReader?: ReaderCompareSeed | null;
}

function ZoomControls({
  zoom,
  setZoom,
  ariaLabel,
}: {
  zoom: number;
  setZoom: (fn: (z: number) => number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="zoom-controls compare-pane-zoom" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className="zoom-btn"
        onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))}
        title="Zoom out"
        disabled={zoom <= 0.4}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      <span className="zoom-level">{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        className="zoom-btn"
        onClick={() => setZoom((z) => Math.min(2.0, +(z + 0.1).toFixed(1)))}
        title="Zoom in"
        disabled={zoom >= 2.0}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
    </div>
  );
}

export function ComparePdfView({ aiEnabled, initialLeftFromReader = null }: ComparePdfViewProps) {
  const [left, setLeft] = useState<SideState>(emptySide);
  const [right, setRight] = useState<SideState>(emptySide);
  const [zoomLeft, setZoomLeft] = useState(1.0);
  const [zoomRight, setZoomRight] = useState(1.0);
  const [syncScroll, setSyncScroll] = useState(false);
  const [compareData, setCompareData] = useState<CompareResponse | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const ignoreScrollSync = useRef(false);

  useEffect(() => {
    if (!initialLeftFromReader) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed left from Reader handoff
    setLeft({
      fileName: initialLeftFromReader.fileName,
      pdf: initialLeftFromReader.pdf,
      structure: initialLeftFromReader.structure,
      docId: initialLeftFromReader.docId,
      loadState: 'idle',
      loadError: null,
    });
  }, [initialLeftFromReader]);

  const syncFrom = useCallback(
    (source: Side) => {
      if (!syncScroll) return;
      const srcEl = source === 'left' ? leftScrollRef.current : rightScrollRef.current;
      const dstEl = source === 'left' ? rightScrollRef.current : leftScrollRef.current;
      if (!srcEl || !dstEl) return;
      const maxSrc = srcEl.scrollHeight - srcEl.clientHeight;
      const maxDst = dstEl.scrollHeight - dstEl.clientHeight;
      if (maxSrc <= 0 || maxDst <= 0) return;
      const ratio = maxSrc > 0 ? srcEl.scrollTop / maxSrc : 0;
      ignoreScrollSync.current = true;
      dstEl.scrollTop = ratio * maxDst;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ignoreScrollSync.current = false;
        });
      });
    },
    [syncScroll],
  );

  const onLeftScroll = useCallback(() => {
    if (ignoreScrollSync.current) return;
    syncFrom('left');
  }, [syncFrom]);

  const onRightScroll = useCallback(() => {
    if (ignoreScrollSync.current) return;
    syncFrom('right');
  }, [syncFrom]);

  const loadSide = useCallback(
    async (side: Side, file: File) => {
      const setSide = side === 'left' ? setLeft : setRight;
      setSide((s) => ({
        ...s,
        loadState: 'loading',
        loadError: null,
        fileName: file.name,
      }));
      try {
        const buffer = await file.arrayBuffer();
        const copy = buffer.slice(0);
        const doc = await pdfjsLib.getDocument({ data: copy }).promise;
        const struct = await extractPdfStructure(doc);
        let docId: string | null = null;
        if (aiEnabled) {
          try {
            const parsed = await api.parse(file);
            docId = parsed.doc_id;
          } catch {
            docId = null;
          }
        }
        setSide({
          fileName: file.name,
          pdf: doc,
          structure: struct,
          docId,
          loadState: 'idle',
          loadError: null,
        });
      } catch (e) {
        console.error(e);
        setSide({
          ...emptySide(),
          loadState: 'error',
          loadError: e instanceof Error ? e.message : 'Failed to load PDF',
        });
      }
    },
    [aiEnabled],
  );

  const canCompare = Boolean(left.docId && right.docId && aiEnabled);

  const showCompareInsights =
    canCompare &&
    (compareLoading ||
      Boolean(compareError) ||
      Boolean(
        compareData &&
          (compareData.aligned_sections.length > 0 || compareData.differences.length > 0),
      ));

  useEffect(() => {
    if (!canCompare) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompareLoading(true);
    setCompareError(null);
    api
      .compare(left.docId!, right.docId!)
      .then((data) => {
        if (!cancelled) setCompareData(data);
      })
      .catch((e) => {
        if (!cancelled) setCompareError(e instanceof Error ? e.message : 'Compare failed');
      })
      .finally(() => {
        if (!cancelled) setCompareLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canCompare, left.docId, right.docId]);

  return (
    <div className="compare-view">
      <div className="compare-toolbar">
        <label className="compare-sync-toggle">
          <input
            type="checkbox"
            checked={syncScroll}
            onChange={(e) => setSyncScroll(e.target.checked)}
          />
          <span>Sync scroll</span>
        </label>
      </div>

      {showCompareInsights && (
        <div className="compare-insights">
          {compareLoading && <p className="compare-insights-status">Analyzing alignment…</p>}
          {compareError && <p className="compare-insights-error">{compareError}</p>}
          {compareData && !compareLoading && (
            <>
              {compareData.aligned_sections.length > 0 && (
                <div className="compare-aligned">
                  <p className="compare-insights-heading">Aligned sections</p>
                  <ul>
                    {compareData.aligned_sections.map((a, i) => (
                      <li key={`${a.left_index}-${a.right_index}-${i}`}>
                        <span className="compare-pair-left">{a.left_title}</span>
                        <span className="compare-pair-arrow">↔</span>
                        <span className="compare-pair-right">{a.right_title}</span>
                        <span className="compare-sim">{(a.similarity * 100).toFixed(0)}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {compareData.differences.length > 0 && (
                <div className="compare-diffs">
                  <p className="compare-insights-heading">Key differences</p>
                  <ul>
                    {compareData.differences.map((d, i) => (
                      <li key={i}>
                        <span className="compare-diff-type">{d.type}</span>
                        <span className="compare-diff-desc">{d.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="compare-panes">
        <div className="compare-pane">
          <div className="compare-pane-header">
            <span className="compare-pane-label">Left</span>
            <div className="compare-pane-header-actions">
              <label className="file-input compare-file-input">
                Open PDF
                <input
                  type="file"
                  accept="application/pdf"
                  disabled={left.loadState === 'loading'}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadSide('left', f);
                    e.target.value = '';
                  }}
                />
              </label>
              <ZoomControls zoom={zoomLeft} setZoom={setZoomLeft} ariaLabel="Left pane zoom" />
            </div>
          </div>
          {left.loadError && <div className="load-error-banner" role="alert">{left.loadError}</div>}
          <div
            className="compare-scroll"
            ref={leftScrollRef}
            onScroll={onLeftScroll}
          >
            {left.pdf && left.structure ? (
              <PdfDocumentView
                pdf={left.pdf}
                structure={left.structure}
                highlights={[]}
                selectedId={null}
                onHighlightClick={() => {}}
                scrollRootRef={leftScrollRef}
                zoom={zoomLeft}
              />
            ) : (
              <div className="empty-state compare-empty">
                <p>{left.loadState === 'loading' ? 'Loading…' : 'Open a PDF for the left pane.'}</p>
              </div>
            )}
          </div>
        </div>

        <div className="compare-pane">
          <div className="compare-pane-header">
            <span className="compare-pane-label">Right</span>
            <div className="compare-pane-header-actions">
              <label className="file-input compare-file-input">
                Open PDF
                <input
                  type="file"
                  accept="application/pdf"
                  disabled={right.loadState === 'loading'}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadSide('right', f);
                    e.target.value = '';
                  }}
                />
              </label>
              <ZoomControls zoom={zoomRight} setZoom={setZoomRight} ariaLabel="Right pane zoom" />
            </div>
          </div>
          {right.loadError && <div className="load-error-banner" role="alert">{right.loadError}</div>}
          <div
            className="compare-scroll"
            ref={rightScrollRef}
            onScroll={onRightScroll}
          >
            {right.pdf && right.structure ? (
              <PdfDocumentView
                pdf={right.pdf}
                structure={right.structure}
                highlights={[]}
                selectedId={null}
                onHighlightClick={() => {}}
                scrollRootRef={rightScrollRef}
                zoom={zoomRight}
              />
            ) : (
              <div className="empty-state compare-empty">
                <p>{right.loadState === 'loading' ? 'Loading…' : 'Open a PDF for the right pane.'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
