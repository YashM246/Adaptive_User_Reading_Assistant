import type { ResolvedReference } from '../lib/api/client';

export interface ReferencesPanelProps {
  references: ResolvedReference[];
  loading: boolean;
  error: string | null;
  selectedIndex: number | null;
  onReferenceClick: (ref: ResolvedReference) => void;
}

function stripLeadingIndex(raw: string): string {
  return raw.replace(/^\s*\[\d+\]\s*/, '').replace(/^\s*\d+\.\s+/, '');
}

function abbreviateAuthors(authors: string[] | null): string {
  if (!authors || authors.length === 0) return '';
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  const lastName = authors[0].split(' ').pop() || authors[0];
  return `${lastName} et al.`;
}

export function ReferencesPanel({
  references,
  loading,
  error,
  selectedIndex,
  onReferenceClick,
}: ReferencesPanelProps) {
  if (loading) {
    return (
      <div className="references-panel">
        <div className="references-panel-header">
          <p className="section-label">References</p>
        </div>
        <div className="ref-loading-spinner">
          <div className="ref-spinner" />
          <span>Extracting references…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="references-panel">
        <div className="references-panel-header">
          <p className="section-label">References</p>
        </div>
        <p className="ref-error">{error}</p>
      </div>
    );
  }

  if (references.length === 0) {
    return null;
  }

  const resolvedCount = references.filter((r) => r.resolved).length;

  return (
    <div className="references-panel">
      <div className="references-panel-header">
        <p className="section-label">References</p>
        <span className="ref-count">
          {resolvedCount} of {references.length} resolved
        </span>
      </div>
      <p className="ref-subtitle">Extracted from left PDF</p>

      <div className="ref-card-list">
        {references.map((ref) => {
          const available = ref.resolved && ref.open_access_pdf_url;
          const isActive = selectedIndex === ref.index;
          const cardClass = [
            'ref-card',
            available ? 'available' : 'unavailable',
            isActive ? 'active' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={ref.index}
              type="button"
              className={cardClass}
              disabled={!available}
              title={
                available
                  ? `Open: ${ref.title || ref.raw_text}`
                  : 'No open-access PDF found'
              }
              onClick={() => available && onReferenceClick(ref)}
            >
              <span className="ref-card-title">
                [{ref.index + 1}]{' '}
                {ref.title || stripLeadingIndex(ref.raw_text).slice(0, 120)}
              </span>
              <span className="ref-card-meta">
                {ref.authors ? abbreviateAuthors(ref.authors) : ''}
                {ref.year ? ` ${ref.year}` : ''}
              </span>
              <span className="ref-card-badge">
                {available ? (
                  <span className="ref-badge-available">PDF available</span>
                ) : (
                  <span className="ref-badge-unavailable">No open PDF</span>
                )}
              </span>
              {isActive && (
                <span className="ref-card-loading-indicator">
                  <div className="ref-spinner ref-spinner-sm" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
