import { useCallback, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import type { DocumentStructure } from '../types/aura';
import { localContext } from '../lib/structure/explanationContext';
import { api } from '../lib/api/client';

export interface ExplanationPanelProps {
  structure: DocumentStructure | null;
  selectedText: string | null;
  docId: string | null;
  aiEnabled: boolean;
  onClose: () => void;
}

export function ExplanationPanel({
  structure,
  selectedText,
  docId,
  aiEnabled,
  onClose,
}: ExplanationPanelProps) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [askInput, setAskInput] = useState('');
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askConfidence, setAskConfidence] = useState<number | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const contextText = useMemo(() => {
    if (!structure || !selectedText) return '';
    const idx = structure.fullText.indexOf(selectedText.slice(0, 80));
    const center = idx >= 0 ? idx + selectedText.length / 2 : 0;
    return localContext(structure, Math.floor(center));
  }, [structure, selectedText]);

  const fetchExplanation = useCallback(async () => {
    if (!selectedText || !docId || !aiEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const ctx = contextText || selectedText;
      const resp = await api.explain(docId, selectedText, ctx, 'plain');
      setExplanation(resp.explanation);
      setConfidence(resp.confidence);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Explanation failed');
      setExplanation(null);
      setConfidence(null);
    } finally {
      setLoading(false);
    }
  }, [selectedText, docId, aiEnabled, contextText]);

  useEffect(() => {
    if (selectedText && docId && aiEnabled) {
      void fetchExplanation();
    } else {
      setExplanation(null);
      setConfidence(null);
      setError(null);
    }
  }, [selectedText, docId, aiEnabled, fetchExplanation]);

  const sendAsk = useCallback(async () => {
    const q = askInput.trim();
    if (!q || !docId || !aiEnabled) return;
    setAskLoading(true);
    setAskError(null);
    try {
      const resp = await api.query(docId, q);
      setAskAnswer(resp.answer);
      setAskConfidence(resp.confidence);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : 'Question failed');
      setAskAnswer(null);
      setAskConfidence(null);
    } finally {
      setAskLoading(false);
    }
  }, [askInput, docId, aiEnabled]);

  const dismissAskResult = useCallback(() => {
    setAskAnswer(null);
    setAskConfidence(null);
    setAskError(null);
  }, []);

  const truncatedQuote = selectedText
    ? selectedText.length > 120 ? `${selectedText.slice(0, 117)}…` : selectedText
    : '';

  const askDisabled = !docId || !aiEnabled || askLoading;

  return (
    <aside className="explanation-panel">
      <div className="explanation-panel-scroll">
        <div className="explanation-header">
          <div className="explanation-header-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sparkles-icon">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
            </svg>
            <span className="explanation-title">Explanation</span>
          </div>
          <span className="explanation-badge">Grounded in this paper</span>
        </div>

        {!selectedText ? (
          <div className="explanation-empty">
            <p>Select any text in the document, then click <strong>Explain this</strong> to see a plain-language explanation grounded in the paper's context.</p>
          </div>
        ) : (
          <div className="explanation-body">
            <div className="quote-card">
              <p className="quote-text">"{truncatedQuote}"</p>
              <span className="quote-label">Selected in the paper</span>
            </div>

            <div className="explain-content-card">
              <span className="explain-content-label">PLAIN LANGUAGE</span>

              {loading && <p className="explain-text loading">Generating explanation…</p>}
              {error && <p className="explain-error">{error}</p>}
              {!loading && !error && explanation && (
                <div className="explain-text markdown-body">
                  <Markdown>{explanation}</Markdown>
                </div>
              )}
              {!loading && !error && !explanation && !docId && (
                <p className="explain-text muted">Upload a PDF with AI enabled to get explanations.</p>
              )}

              {confidence !== null && (
                <div className="confidence-bar">
                  <span className="confidence-label">Confidence</span>
                  <div className="confidence-track">
                    <div className="confidence-fill" style={{ width: `${confidence * 100}%` }} />
                  </div>
                  <span className="confidence-value">{(confidence * 100).toFixed(0)}%</span>
                </div>
              )}
            </div>

            <button type="button" className="btn-ghost" onClick={onClose} style={{ marginTop: 8 }}>
              Clear selection
            </button>
          </div>
        )}
      </div>

      <div className="explanation-panel-ask">
        <span className="ask-section-label">ASK ABOUT THIS PAPER</span>
        <p className="ask-section-desc">
          Type a question — answers use parsed text from this PDF (from the start; very long papers may be truncated to fit the model). Separate from “Explain this” above.
        </p>
        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            void sendAsk();
          }}
        >
          <input
            type="text"
            className="ask-input"
            placeholder="e.g. What learning rate did they use?"
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            disabled={askDisabled}
          />
          <button type="submit" className="btn ask-submit" disabled={askDisabled || !askInput.trim()}>
            {askLoading ? '…' : 'Ask'}
          </button>
        </form>
        {!docId && aiEnabled && (
          <p className="ask-muted">Open a PDF with the backend running so the document is parsed for Q&amp;A.</p>
        )}
        {!aiEnabled && (
          <p className="ask-muted">Turn on AI Assist to ask questions.</p>
        )}
        {(askError || askAnswer) && (
          <div className="ask-result-block">
            <div className="ask-result-toolbar">
              <span className="ask-result-label">{askError ? 'Could not answer' : 'Answer'}</span>
              <button
                type="button"
                className="ask-dismiss-btn"
                onClick={dismissAskResult}
                aria-label="Dismiss answer"
                title="Clear answer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {askError && <p className="ask-error">{askError}</p>}
            {askAnswer && (
              <div className="ask-answer markdown-body">
                <Markdown>{askAnswer}</Markdown>
                {askConfidence !== null && (
                  <div className="confidence-bar ask-confidence">
                    <span className="confidence-label">Confidence</span>
                    <div className="confidence-track">
                      <div className="confidence-fill" style={{ width: `${askConfidence * 100}%` }} />
                    </div>
                    <span className="confidence-value">{(askConfidence * 100).toFixed(0)}%</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
