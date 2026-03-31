import { useCallback, useRef, useState } from 'react';
import type { ReadingPathStep, TextSpan } from '../types/aura';

export interface ReadingPathPanelProps {
  steps: ReadingPathStep[];
  activeStepId: string | null;
  onJump: (span: TextSpan) => void;
  onReorder?: (steps: ReadingPathStep[]) => void;
}

export function ReadingPathPanel({
  steps,
  activeStepId,
  onJump,
  onReorder,
}: ReadingPathPanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragOverIndex = useRef<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverIndex.current = index;
  }, []);

  const handleDrop = useCallback(() => {
    if (dragIndex === null || dragOverIndex.current === null || dragIndex === dragOverIndex.current) {
      setDragIndex(null);
      return;
    }
    const reordered = [...steps];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dragOverIndex.current, 0, moved);
    const renumbered = reordered.map((s, i) => ({ ...s, order: i }));
    onReorder?.(renumbered);
    setDragIndex(null);
    dragOverIndex.current = null;
  }, [dragIndex, steps, onReorder]);

  if (steps.length === 0) {
    return (
      <div className="path-panel empty">
        No path yet. Load a PDF and pick a reading goal.
      </div>
    );
  }

  return (
    <div className="path-panel">
      <div className="path-list">
        {steps.map((s, i) => {
          const isActive = activeStepId === s.span.id;
          return (
            <div
              key={s.span.id}
              draggable
              className={`path-item ${dragIndex === i ? 'dragging' : ''} ${isActive ? 'active' : ''}`}
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={handleDrop}
              onDragEnd={() => setDragIndex(null)}
            >
              <button type="button" className="path-step" onClick={() => onJump(s.span)}>
                <span className="path-order">{s.order + 1}</span>
                <div className="path-step-content">
                  <span className="path-section-title">{s.sectionTitle}</span>
                  <span className="path-rationale">{s.rationale}</span>
                </div>
                {s.priority === 'high' && <span className="path-priority-dot high" />}
                {s.priority === 'medium' && <span className="path-priority-dot medium" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
