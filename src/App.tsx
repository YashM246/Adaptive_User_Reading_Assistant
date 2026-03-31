import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import * as pdfjsLib from 'pdfjs-dist';
import { PdfDocumentView } from './components/PdfDocumentView';
import { ReadingPathPanel } from './components/ReadingPathPanel';
import { ExplanationPanel } from './components/ExplanationPanel';
import { setupPdfWorker } from './lib/pdf/setup';
import { buildReadingPath } from './lib/retrieval/goalRetrieval';
import { extractPdfStructure, spanFromCharRange } from './lib/structure/extractPdfStructure';
import { scrollToSpan } from './lib/ui/scrollToSpan';
import { api } from './lib/api/client';
import type { ReadingGoal, ReadingPathStep, Rect, TextSpan } from './types/aura';
import type { ReadingPathResponse } from './lib/api/client';
import './App.css';

setupPdfWorker();

function applyServerReadingPath(
  resp: ReadingPathResponse,
  struct: Awaited<ReturnType<typeof extractPdfStructure>>,
): { steps: ReadingPathStep[]; highlights: TextSpan[] } | null {
  if (!resp.steps?.length) return null;
  const serverSteps: ReadingPathStep[] = resp.steps
    .map((s, i) => {
      const section = struct.sections[s.section_index];
      const span = section
        ? spanFromCharRange(
          struct,
          section.startCharGlobal,
          Math.min(section.startCharGlobal + 500, section.endCharGlobal),
          `srv-${i}`,
        )
        : null;
      return {
        order: i,
        sectionTitle: s.section_title,
        rationale: s.rationale,
        priority: s.priority,
        span: span ?? { id: `srv-${i}`, pageIndex: 0, rects: [], text: '' },
      };
    })
    .filter((s) => s.span.rects.length > 0);
  if (serverSteps.length === 0) return null;
  const serverHighlights: TextSpan[] = [];
  for (const s of serverSteps) {
    const section = struct.sections.find((sec) => sec.title === s.sectionTitle);
    if (section) {
      const hl = spanFromCharRange(
        struct,
        section.startCharGlobal,
        section.endCharGlobal,
        `srv-hl-${s.order}`,
      );
      if (hl) serverHighlights.push(hl);
    }
  }
  const highlights =
    serverHighlights.length > 0
      ? serverHighlights
      : serverSteps.map((s, i) => ({ ...s.span, id: `srv-hl-${i}` }));
  return { steps: serverSteps, highlights };
}

const GOALS: { value: ReadingGoal; label: string; icon: string }[] = [
  { value: 'screening', label: 'Skim for relevance', icon: '⚡' },
  { value: 'study', label: 'Deep study', icon: '📖' },
  { value: 'methods_critique', label: 'Critique methods', icon: '🔬' },
  { value: 'extract_contributions', label: 'Get the big idea', icon: '💡' },
  { value: 'implementation', label: 'Replicate this method', icon: '🔧' },
  { value: 'custom', label: 'Custom…', icon: '✏️' },
];

function App() {
  const [fileName, setFileName] = useState('');
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [structure, setStructure] = useState<Awaited<ReturnType<typeof extractPdfStructure>> | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [goal, setGoal] = useState<ReadingGoal>('screening');
  const [customGoal, setCustomGoal] = useState('');
  const [steps, setSteps] = useState<ReadingPathStep[]>([]);
  const [highlights, setHighlights] = useState<TextSpan[]>([]);
  const [selectedSpan, setSelectedSpan] = useState<TextSpan | null>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [explainPopup, setExplainPopup] = useState<{ text: string; pageIndex: number; rect: Rect } | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [zoom, setZoom] = useState(1.0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!structure) return;
    const customDesc = goal === 'custom' ? customGoal.trim() : undefined;
    const path = buildReadingPath(
      structure,
      goal,
      customDesc && customDesc.length > 0 ? customDesc : undefined,
    );
    setSteps(path.steps);
    setHighlights(path.highlights);
  }, [structure, goal, customGoal]);

  useEffect(() => {
    if (!docId || !aiEnabled || !structure) return;
    const delay = goal === 'custom' ? 450 : 0;
    const handle = window.setTimeout(() => {
      api
        .readingPath(docId, goal, goal === 'custom' ? customGoal.trim() || undefined : undefined)
        .then((resp) => {
          const merged = applyServerReadingPath(resp, structure);
          if (merged) {
            setSteps(merged.steps);
            setHighlights(merged.highlights);
          }
        })
        .catch(() => {});
    }, delay);
    return () => clearTimeout(handle);
  }, [docId, aiEnabled, structure, goal, customGoal]);

  const loadPdfFile = useCallback(async (file: File) => {
    setLoadState('loading');
    setLoadError(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const copy = buffer.slice(0);
      const doc = await pdfjsLib.getDocument({ data: copy }).promise;
      const struct = await extractPdfStructure(doc);
      setPdf(doc);
      setStructure(struct);

      let parsedDocId: string | null = null;
      if (aiEnabled) {
        try {
          const parsed = await api.parse(file);
          parsedDocId = parsed.doc_id;
          setDocId(parsedDocId);
          setBackendAvailable(true);
        } catch {
          setDocId(null);
          setBackendAvailable(false);
        }
      }

      setSelectedSpan(null);
      setSelectedText(null);
      setExplainPopup(null);
      setLoadState('idle');
    } catch (e) {
      console.error(e);
      setLoadState('error');
      setLoadError(e instanceof Error ? e.message : 'Failed to load PDF');
      setPdf(null);
      setStructure(null);
    }
  }, [goal, customGoal, aiEnabled]);

  const onGoalChange = useCallback(
    (g: ReadingGoal) => {
      setGoal(g);
      if (structure) {
        setSelectedSpan(null);
        setSelectedText(null);
        setExplainPopup(null);
      }
    },
    [structure]
  );

  const jumpToSpan = useCallback(
    (span: TextSpan) => {
      setSelectedSpan(span);
      scrollToSpan(scrollRef.current, span);
    },
    []
  );

  const jumpToChar = useCallback(
    (offset: number) => {
      if (!structure) return;
      const span = spanFromCharRange(
        structure, offset, Math.min(offset + 1, structure.fullText.length), 'def-jump'
      );
      if (span) {
        setSelectedSpan(span);
        scrollToSpan(scrollRef.current, span);
      }
    },
    [structure]
  );

  const onStepsReorder = useCallback((newSteps: ReadingPathStep[]) => {
    setSteps(newSteps);
  }, []);

  const handleTextSelect = useCallback((text: string, pageIndex: number, rect: Rect) => {
    setExplainPopup({ text, pageIndex, rect });
  }, []);

  const handleExplainClick = useCallback(() => {
    if (!explainPopup) return;
    setSelectedText(explainPopup.text);
    setExplainPopup(null);
    window.getSelection()?.removeAllRanges();
  }, [explainPopup]);

  useEffect(() => {
    if (!explainPopup) return;
    const handleDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.explain-this-btn')) return;
      setExplainPopup(null);
    };
    const handleScroll = () => setExplainPopup(null);
    document.addEventListener('mousedown', handleDown);
    scrollRef.current?.addEventListener('scroll', handleScroll);
    const scrollEl = scrollRef.current;
    return () => {
      document.removeEventListener('mousedown', handleDown);
      scrollEl?.removeEventListener('scroll', handleScroll);
    };
  }, [explainPopup]);

  const handleHighlightClick = useCallback((span: TextSpan) => {
    setSelectedSpan(span);
    setSelectedText(span.text);
    setExplainPopup(null);
  }, []);

  return (
    <div className="app">
      {/* Left panel */}
      <aside className="left-panel">
        <div className="brand-row">
          <div className="brand-mark">A</div>
          <div className="brand-text">
            <h1>Aura</h1>
            <p className="brand-tagline">Goal paths &middot; grounded explanations</p>
          </div>
        </div>

        <div className="left-panel-body">
          <p className="section-label">Your Reading Goal</p>
          <div className="goal-chips">
            {GOALS.map((g) => (
              <button
                key={g.value}
                type="button"
                className={`goal-chip ${goal === g.value ? 'active' : ''}`}
                onClick={() => onGoalChange(g.value)}
              >
                <span className="goal-chip-icon">{g.icon}</span>
                {g.label}
              </button>
            ))}
          </div>

          {goal === 'custom' && (
            <div className="custom-goal-wrap">
              <input
                type="text"
                className="custom-goal-input"
                placeholder="e.g. focus on fairness metrics and evaluation"
                value={customGoal}
                onChange={(e) => setCustomGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <p className="custom-goal-hint">
                Your text is turned into search terms to rank sections. Press Enter or leave the field to refresh the path.
              </p>
            </div>
          )}

          <div className="path-section-header">
            <p className="section-label">Ordered Path</p>
            <span className="path-edit-hint">Guidance, not a constraint</span>
          </div>

          <ReadingPathPanel
            steps={steps}
            activeStepId={selectedSpan?.id ?? null}
            onJump={jumpToSpan}
            onReorder={onStepsReorder}
          />

          <label className="ai-toggle">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
            />
            <span className="ai-toggle-label">AI Assist</span>
          </label>
        </div>
      </aside>

      {/* Center column */}
      <div className="center-column">
        {!backendAvailable && aiEnabled && (
          <div className="fallback-banner">
            Backend unavailable — using local parsing (AI features disabled).
            <button type="button" className="btn-link" onClick={() => setBackendAvailable(true)}>
              Retry
            </button>
          </div>
        )}

        <section className="toolbar">
          <div className="toolbar-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="toolbar-title">
              {loadState === 'loading' ? 'Processing PDF…' : fileName || 'No file loaded'}
            </span>
          </div>
          <div className="toolbar-right">
            {pdf && (
              <div className="zoom-controls">
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))}
                  title="Zoom out"
                  disabled={zoom <= 0.4}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="11" y1="8" x2="11" y2="14" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                  </svg>
                </button>
              </div>
            )}
            <label className="file-input">
              Open PDF
              <input
                type="file"
                accept="application/pdf"
                disabled={loadState === 'loading'}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadPdfFile(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </section>

        {loadState === 'error' && loadError && (
          <div className="load-error-banner" role="alert">{loadError}</div>
        )}

        <div className="reader-column" ref={scrollRef}>
          {pdf && structure ? (
            <div className="reader-pdf-stack">
              <PdfDocumentView
                pdf={pdf}
                structure={structure}
                highlights={highlights}
                selectedId={selectedSpan?.id ?? null}
                onHighlightClick={handleHighlightClick}
                onTextSelect={handleTextSelect}
                scrollRootRef={scrollRef}
                zoom={zoom}
              />

              {explainPopup && (
                <button
                  type="button"
                  className="explain-this-btn"
                  style={{
                    position: 'fixed',
                    left: explainPopup.rect.x + explainPopup.rect.width / 2,
                    top: explainPopup.rect.y + explainPopup.rect.height + 8,
                    transform: 'translateX(-50%)',
                  }}
                  onClick={handleExplainClick}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                  </svg>
                  Explain this
                </button>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <p>Open a research PDF to begin reading.</p>
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="right-panel">
        <ExplanationPanel
          structure={structure}
          selectedText={selectedText}
          docId={docId}
          aiEnabled={aiEnabled}
          onJumpToChar={jumpToChar}
          onClose={() => {
            setSelectedText(null);
            setSelectedSpan(null);
          }}
        />
      </div>
    </div>
  );
}

export default App;
