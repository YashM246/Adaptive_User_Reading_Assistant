import type {
  DocumentStructure,
  ReadingGoal,
  ReadingPathStep,
  TextSpan,
} from '../../types/aura';
import type { HighlightExcerpt } from '../api/client';
import { api } from '../api/client';
import {
  spanFromCharRange,
  highlightSpansFromCharRange,
} from '../structure/extractPdfStructure';

/**
 * Call the backend LLM highlight endpoint and convert the returned
 * text excerpts into ReadingPathSteps + TextSpan highlights that the
 * existing UI can render without changes.
 */
export async function buildLlmReadingPath(
  structure: DocumentStructure,
  docId: string,
  goal: ReadingGoal,
  customGoal?: string,
): Promise<{ steps: ReadingPathStep[]; highlights: TextSpan[] }> {
  const response = await api.getHighlights(
    docId, goal, customGoal, structure.fullText,
  );
  return mapExcerptsToPath(structure, response.highlights);
}

function mapExcerptsToPath(
  structure: DocumentStructure,
  excerpts: HighlightExcerpt[],
): { steps: ReadingPathStep[]; highlights: TextSpan[] } {
  const { fullText } = structure;
  const steps: ReadingPathStep[] = [];
  const highlights: TextSpan[] = [];

  for (const excerpt of excerpts) {
    const range = findExcerptInText(fullText, excerpt.text);
    if (!range) continue;

    const i = steps.length;
    const span = spanFromCharRange(structure, range.start, range.end, `path-${i}`);
    if (!span || span.rects.length === 0) continue;

    const hlSpans = highlightSpansFromCharRange(
      structure,
      range.start,
      range.end,
      `hl-${i}`,
    );
    for (const hl of hlSpans) {
      if (hl.rects.length > 0) highlights.push(hl);
    }

    steps.push({
      order: i,
      sectionTitle: excerpt.section || 'Untitled',
      rationale: excerpt.rationale || '',
      priority: excerpt.priority,
      span,
    });
  }

  return { steps, highlights };
}

// ---------------------------------------------------------------------------
// Text matching: find a verbatim LLM excerpt in the frontend fullText
// ---------------------------------------------------------------------------

function findExcerptInText(
  fullText: string,
  excerpt: string,
): { start: number; end: number } | null {
  const idx = fullText.indexOf(excerpt);
  if (idx >= 0) return { start: idx, end: idx + excerpt.length };

  const normExcerpt = normalize(excerpt);
  if (normExcerpt.length < 20) return null;

  const normFull = normalize(fullText);
  const normIdx = normFull.indexOf(normExcerpt);
  if (normIdx >= 0) {
    return mapNormalizedRange(fullText, normIdx, normExcerpt.length);
  }

  return null;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Given a match position in a whitespace-normalized version of `original`,
 * map it back to start/end offsets in the original string.
 *
 * Walk through the original string, advancing a "normalized index" counter
 * that collapses runs of whitespace to a single space.  When the counter
 * reaches `normStart`, record the original position; when it reaches
 * `normStart + normLen`, record the end.
 */
function mapNormalizedRange(
  original: string,
  normStart: number,
  normLen: number,
): { start: number; end: number } | null {
  let ni = 0;
  let start = -1;
  let inSpace = false;
  let leading = true;

  for (let oi = 0; oi < original.length; oi++) {
    const ch = original[oi];
    const isWs = /\s/.test(ch);

    if (leading) {
      if (isWs) continue;
      leading = false;
    }

    if (isWs) {
      if (!inSpace) {
        inSpace = true;
        ni++;
      }
    } else {
      inSpace = false;
      ni++;
    }

    if (start < 0 && ni > normStart) {
      start = oi;
    }
    if (start >= 0 && ni >= normStart + normLen) {
      return { start, end: oi + 1 };
    }
  }

  return null;
}
