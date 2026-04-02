import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import * as pdfjsLib from 'pdfjs-dist';
import { PdfDocumentView } from './components/PdfDocumentView';
import { ReadingPathPanel } from './components/ReadingPathPanel';
import { ExplanationPanel } from './components/ExplanationPanel';
import { ComparePdfView } from './components/ComparePdfView';
import { setupPdfWorker } from './lib/pdf/setup';
import { buildReadingPath } from './lib/readingPath';
import { extractPdfStructure } from './lib/structure/extractPdfStructure';
import { scrollToSpan } from './lib/ui/scrollToSpan';
import { api } from './lib/api/client';
import type { ReadingGoal, ReadingPathStep, Rect, TextSpan } from './types/aura';
import './App.css';

setupPdfWorker();

const GOALS: { value: ReadingGoal; label: string; icon: string }[] = [
  { value: 'screening', label: 'Skim for relevance', icon: '⚡' },
  { value: 'study', label: 'Deep study', icon: '📖' },
  { value: 'custom', label: 'Custom…', icon: '✏️' },
];

type AppView = 'reader' | 'compare';

function App() {
  const [appView, setAppView] = useState<AppView>('reader');
  const [fileName, setFileName] = useState('');
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [structure, setStructure] = useState<Awaited<ReturnType<typeof extractPdfStructure>> | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [goal, setGoal] = useState<ReadingGoal>('screening');
  const [customGoalDraft, setCustomGoalDraft] = useState('');
  const [customGoalApplied, setCustomGoalApplied] = useState('');
  const [steps, setSteps] = useState<ReadingPathStep[]>([]);
  const [highlights, setHighlights] = useState<TextSpan[]>([]);
  const [selectedSpan, setSelectedSpan] = useState<TextSpan | null>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [explainPopup, setExplainPopup] = useState<{ text: string; pageIndex: number; rect: Rect } | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [zoom, setZoom] = useState(1.0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const compareSeedFromReader = useMemo(() => {
    if (!pdf || !structure) return null;
    return { pdf, structure, fileName, docId };
  }, [pdf, structure, fileName, docId]);

  useEffect(() => {
    if (!structure) return;
    if (goal === 'custom' && !customGoalApplied.trim()) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPathLoading(true);
    const path = buildReadingPath(
      structure,
      goal,
      goal === 'custom' ? customGoalApplied.trim() : undefined,
    );
    setSteps(path.steps);
    setHighlights(path.highlights);
    setPathLoading(false);
  }, [structure, goal, customGoalApplied]);

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
      // Prevent using a stale doc_id after loading a new file.
      setDocId(null);

      if (aiEnabled) {
        try {
          const parsed = await api.parse(file);
          setDocId(parsed.doc_id);
          setBackendAvailable(true);
        } catch {
          setDocId(null);
          setBackendAvailable(false);
        }
      } else {
        setDocId(null);
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
  }, [aiEnabled]);

  const applyCustomGoal = useCallback(() => {
    const t = customGoalDraft.trim();
    if (!t) return;
    setCustomGoalApplied(t);
  }, [customGoalDraft]);

  const onGoalChange = useCallback(
    (g: ReadingGoal) => {
      setGoal(g);
      if (g === 'custom') {
        setCustomGoalApplied('');
      }
      if (structure) {
        setSelectedSpan(null);
        setSelectedText(null);
        setExplainPopup(null);
      }
    },
    [structure],
  );

  const jumpToSpan = useCallback(
    (span: TextSpan) => {
      setSelectedSpan(span);
      scrollToSpan(scrollRef.current, span);
    },
    [],
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

  const pathEmptyMessage =
    goal === 'custom' && !customGoalApplied.trim() && structure
      ? 'Describe your goal below and click Apply goal (or press Enter).'
      : undefined;

  const customPending = goal === 'custom' && !customGoalApplied.trim();
  const displaySteps = customPending ? [] : steps;
  const displayHighlights = customPending ? [] : highlights;
  const displayPathLoading = pathLoading && !customPending;

  return (
    <div className="app">
      {appView === 'reader' && (
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
                <div className="custom-goal-row">
                  <input
                    type="text"
                    className="custom-goal-input"
                    placeholder="e.g. focus on fairness metrics and evaluation"
                    value={customGoalDraft}
                    onChange={(e) => setCustomGoalDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyCustomGoal();
                      }
                    }}
                  />
                  <button type="button" className="btn-apply-goal" onClick={applyCustomGoal}>
                    Apply goal
                  </button>
                </div>
                <p className="custom-goal-hint">
                  Apply when ready — sections matching your words are preferred; otherwise common methods/results blocks are used.
                </p>
              </div>
            )}

            <div className="ordered-path-scroll">
              <div className="path-section-header">
                <p className="section-label">Ordered Path</p>
                <span className="path-edit-hint">Guidance, not a constraint</span>
              </div>

              <ReadingPathPanel
                steps={displaySteps}
                activeStepId={selectedSpan?.id ?? null}
                onJump={jumpToSpan}
                onReorder={onStepsReorder}
                loading={displayPathLoading}
                emptyMessage={pathEmptyMessage}
              />
              <p className="path-local-hint">Path from PDF text structure in your browser.</p>
            </div>

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
      )}

      {appView === 'compare' && (
        <aside className="left-panel compare-left-rail">
          <div className="brand-row">
            <div className="brand-mark">A</div>
            <div className="brand-text">
              <h1>Aura</h1>
              <p className="brand-tagline">Compare PDFs</p>
            </div>
          </div>
          <div className="left-panel-body compare-rail-body">
            <p className="section-label">Mode</p>
            <p className="compare-rail-copy">
              Open two PDFs side by side. Enable sync scroll to move through both at once. AI Assist uses the backend for alignment hints when both files parse successfully.
            </p>
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
      )}

      <div className="center-column">
        {!backendAvailable && aiEnabled && appView === 'reader' && (
          <div className="fallback-banner">
            Backend unavailable — using local parsing (AI features disabled).
            <button type="button" className="btn-link" onClick={() => setBackendAvailable(true)}>
              Retry
            </button>
          </div>
        )}

        <section className="toolbar">
          <div className="toolbar-left">
            <div className="view-switch" role="tablist" aria-label="App view">
              <button
                type="button"
                role="tab"
                aria-selected={appView === 'reader'}
                className={`view-switch-btn ${appView === 'reader' ? 'active' : ''}`}
                onClick={() => setAppView('reader')}
              >
                Reader
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={appView === 'compare'}
                className={`view-switch-btn ${appView === 'compare' ? 'active' : ''}`}
                onClick={() => setAppView('compare')}
              >
                Compare PDFs
              </button>
            </div>
            {appView === 'reader' && (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="toolbar-title">
                  {loadState === 'loading' ? 'Processing PDF…' : fileName || 'No file loaded'}
                </span>
              </>
            )}
            {appView === 'compare' && (
              <span className="toolbar-title">Side-by-side PDFs</span>
            )}
          </div>
          <div className="toolbar-right">
            {appView === 'reader' && pdf && (
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
            {appView === 'reader' && (
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
            )}
          </div>
        </section>

        {appView === 'compare' ? (
          <ComparePdfView aiEnabled={aiEnabled} initialLeftFromReader={compareSeedFromReader} />
        ) : (
          <>
            {loadState === 'error' && loadError && (
              <div className="load-error-banner" role="alert">{loadError}</div>
            )}

            <div className="reader-column" ref={scrollRef}>
              {pdf && structure ? (
                <div className="reader-pdf-stack">
                  <PdfDocumentView
                    pdf={pdf}
                    structure={structure}
                    highlights={displayHighlights}
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
          </>
        )}
      </div>

      {appView === 'reader' && (
        <div className="right-panel">
          <ExplanationPanel
            structure={structure}
            selectedText={selectedText}
            docId={docId}
            aiEnabled={aiEnabled}
            onClose={() => {
              setSelectedText(null);
              setSelectedSpan(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

export default App;
