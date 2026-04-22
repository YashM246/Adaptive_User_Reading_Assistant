import type {
  DocumentStructure,
  ReadingGoal,
  ReadingPathStep,
  Section,
  TextSpan,
} from '../../types/aura';
import {
  spanFromCharRange,
  highlightSpansFromCharRange,
} from '../structure/extractPdfStructure';

const MAX_STEPS = 12;
const DEFAULT_MAX_SPAN_CHARS = 2000;

/** Sections that are never part of the reading path unless custom goal explicitly asks. */
const EXCLUDED_ALWAYS = new Set(['references', 'bibliography', 'citations']);

/**
 * Common English stopwords that should be ignored during custom-goal
 * tokenization.  These words appear in nearly every section and produce
 * false-positive matches.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was',
  'were', 'been', 'being', 'have', 'has', 'had', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'need',
  'want', 'know', 'read', 'about', 'also', 'into', 'over', 'such',
  'than', 'them', 'then', 'these', 'those', 'what', 'when', 'where',
  'which', 'while', 'who', 'whom', 'why', 'how', 'all', 'each', 'any',
  'both', 'few', 'more', 'most', 'some', 'other', 'only', 'own', 'same',
  'very', 'just', 'but', 'not', 'too', 'our', 'out', 'its', 'his', 'her',
  'their', 'your', 'use', 'used', 'using', 'like', 'make', 'made',
  'show', 'shown', 'see', 'look', 'find', 'found', 'take', 'give',
  'paper', 'section', 'work', 'study', 'based', 'first', 'second',
  'new', 'well', 'way', 'get', 'set', 'let', 'one', 'two', 'three',
  'figure', 'table', 'propose', 'proposed', 'present', 'presented',
  'approach', 'method', 'model', 'data', 'result', 'results',
  'however', 'therefore', 'thus', 'hence', 'since', 'because',
  'although', 'though', 'still', 'yet', 'even', 'much', 'many',
  'where', 'there', 'here', 'after', 'before', 'between', 'through',
  'during', 'without', 'within', 'under', 'upon', 'above', 'below',
  'focus', 'understand', 'describe', 'explain', 'discuss', 'analyze',
  'compare', 'consider', 'include', 'provide', 'apply', 'perform',
]);

function isReferencesLike(section: Section): boolean {
  const t = section.normalizedTitle;
  if (EXCLUDED_ALWAYS.has(t)) return true;
  const preview = section.preview.toLowerCase();
  const lines = preview.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  const citeLines = lines.filter((line) => {
    const s = line.trim();
    return (
      /^\[\d+\]/.test(s) ||
      (/\bet al\.?\b/i.test(s) && /\b\d{4}\b/.test(s)) ||
      /^[a-z]+\s*[a-z]\.\s*\(\d{4}\)/i.test(s)
    );
  });
  return citeLines.length > lines.length * 0.55;
}

/* ------------------------------------------------------------------ */
/*  Goal-based section orderings                                      */
/* ------------------------------------------------------------------ */

const SCREENING_ORDER = [
  'abstract',
  'introduction',
  'results',
  'conclusion',
  'related_work',
  'background',
  'experiments',
] as const;

const SCREENING_SET = new Set<string>(SCREENING_ORDER);

const STUDY_ORDER = [
  'abstract',
  'introduction',
  'background',
  'related_work',
  'methods',
  'experiments',
  'results',
  'discussion',
  'limitations',
  'conclusion',
] as const;

const STUDY_SET = new Set<string>(STUDY_ORDER);

const CUSTOM_FALLBACK = new Set([
  'abstract',
  'introduction',
  'methods',
  'experiments',
  'results',
  'discussion',
  'conclusion',
]);

function screeningPriority(n: string): number {
  const i = SCREENING_ORDER.indexOf(n as (typeof SCREENING_ORDER)[number]);
  return i >= 0 ? i : 99;
}

function studyPriority(n: string): number {
  const i = STUDY_ORDER.indexOf(n as (typeof STUDY_ORDER)[number]);
  return i >= 0 ? i : 99;
}

/* ------------------------------------------------------------------ */
/*  Tokenization & custom-goal scoring                                */
/* ------------------------------------------------------------------ */

function tokenize(s: string): string[] {
  return [
    ...new Set(
      s
        .toLowerCase()
        .replace(/['']/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
    ),
  ].slice(0, 40);
}

/**
 * Build bigrams from an array of tokens so that multi-word concepts
 * like "model architecture" or "attention mechanism" are matched as
 * a unit.
 */
function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

/**
 * Score how well a section matches the custom goal.
 *
 * Scoring rules:
 *   +5  bigram from goal appears in section title
 *   +3  bigram from goal appears in section preview
 *   +4  token from goal appears in section title
 *   +1  token from goal appears in section preview
 *
 * Returns 0 for no match.
 */
function scoreSectionForCustom(
  sec: Section,
  tokens: string[],
  goalBigrams: string[],
): number {
  const titleLower = sec.title.toLowerCase();
  const previewLower = sec.preview.toLowerCase();

  let score = 0;

  // Bigram matches (higher value — captures multi-word concepts)
  for (const bg of goalBigrams) {
    if (titleLower.includes(bg)) score += 5;
    else if (previewLower.includes(bg)) score += 3;
  }

  // Unigram matches
  for (const t of tokens) {
    if (titleLower.includes(t)) score += 4;
    else if (previewLower.includes(t)) score += 1;
  }

  return score;
}

/* ------------------------------------------------------------------ */
/*  Section filtering & sorting                                       */
/* ------------------------------------------------------------------ */

function filterSectionsForGoal(
  sections: Section[],
  goal: ReadingGoal,
  customDescription?: string,
): Section[] {
  const custom = customDescription?.trim() ?? '';
  const tokens = goal === 'custom' ? tokenize(custom) : [];
  const gBigrams = goal === 'custom' ? bigrams(tokenize(custom)) : [];

  const candidates: Section[] = [];
  for (const sec of sections) {
    if (sec.normalizedTitle === 'document') continue;
    if (isReferencesLike(sec)) continue;
    if (
      sec.normalizedTitle === 'appendix' &&
      !custom.toLowerCase().includes('appendix')
    )
      continue;
    candidates.push(sec);
  }

  if (goal === 'screening') {
    return candidates.filter((sec) => SCREENING_SET.has(sec.normalizedTitle));
  }
  if (goal === 'study') {
    return candidates.filter((sec) => STUDY_SET.has(sec.normalizedTitle));
  }

  // --- Custom goal ---
  if (tokens.length === 0) {
    return candidates.filter((sec) =>
      CUSTOM_FALLBACK.has(sec.normalizedTitle),
    );
  }

  // Score each section
  const scored = candidates.map((sec) => ({
    sec,
    score: scoreSectionForCustom(sec, tokens, gBigrams),
  }));

  // Keep sections with a positive score
  const matched = scored.filter((s) => s.score > 0);

  if (matched.length > 0) {
    // Sort by score descending, then by document order
    matched.sort(
      (a, b) => b.score - a.score || a.sec.startCharGlobal - b.sec.startCharGlobal,
    );
    // Always include abstract for context, even if it didn't match
    const result = matched.map((s) => s.sec);
    const hasAbstract = result.some(
      (s) => s.normalizedTitle === 'abstract',
    );
    if (!hasAbstract) {
      const abstract = candidates.find(
        (s) => s.normalizedTitle === 'abstract',
      );
      if (abstract) result.unshift(abstract);
    }
    return result;
  }

  return candidates.filter((sec) =>
    CUSTOM_FALLBACK.has(sec.normalizedTitle),
  );
}

function sortSectionsForGoal(
  sections: Section[],
  goal: ReadingGoal,
): Section[] {
  const copy = [...sections];
  if (goal === 'screening') {
    copy.sort(
      (a, b) =>
        screeningPriority(a.normalizedTitle) -
          screeningPriority(b.normalizedTitle) ||
        a.startCharGlobal - b.startCharGlobal,
    );
  } else if (goal === 'study') {
    copy.sort(
      (a, b) =>
        studyPriority(a.normalizedTitle) -
          studyPriority(b.normalizedTitle) ||
        a.startCharGlobal - b.startCharGlobal,
    );
  } else {
    // Custom: keep the score-based order from filterSectionsForGoal —
    // it already sorts by relevance, so just maintain that order.
  }
  return copy.slice(0, MAX_STEPS);
}

/* ------------------------------------------------------------------ */
/*  Paragraph snapping                                                */
/* ------------------------------------------------------------------ */

/**
 * Snap the start position forward to the beginning of the body text
 * (past the section title line).  If a `\n\n` or `\n` is found close
 * to `pos` and still within the section, jump past it so highlights
 * begin at body content rather than the heading.
 */
function snapToParagraphStart(
  fullText: string,
  pos: number,
  sectionStart: number,
  sectionEnd: number,
): number {
  // Try to skip past the heading line into body text.
  // Look FORWARD for the first \n\n (title→body gap).
  const fwd2 = fullText.indexOf('\n\n', pos);
  if (fwd2 >= 0 && fwd2 < sectionEnd && fwd2 - pos < 200) {
    let bodyStart = fwd2 + 2;
    while (bodyStart < sectionEnd && fullText[bodyStart] === '\n') bodyStart++;
    if (bodyStart < sectionEnd) return bodyStart;
  }

  // Try single newline forward
  const fwd1 = fullText.indexOf('\n', pos);
  if (fwd1 >= 0 && fwd1 < sectionEnd && fwd1 - pos < 120) {
    const bodyStart = fwd1 + 1;
    if (bodyStart < sectionEnd) return bodyStart;
  }

  return Math.max(sectionStart, pos);
}

/**
 * Find the end offset after consuming up to `maxParagraphs` paragraph
 * breaks (`\n\n`), capped at `maxChars` from start and `sectionEnd`.
 *
 * If fewer than `maxParagraphs` breaks exist in the range, extend to
 * `cap` so the highlight covers the available body text rather than
 * stopping at the very first paragraph boundary (which would produce
 * a title-only highlight when the only `\n\n` is the heading→body gap).
 */
function endAfterParagraphs(
  fullText: string,
  start: number,
  sectionEnd: number,
  maxParagraphs: number,
  maxChars: number,
): number {
  const cap = Math.min(sectionEnd, start + maxChars);
  let pos = start;
  let found = 0;

  for (let p = 0; p < maxParagraphs; p++) {
    const next = fullText.indexOf('\n\n', pos);
    if (next < 0 || next >= cap) break;
    pos = next + 2;
    while (pos < fullText.length && fullText[pos] === '\n') pos++;
    found++;
  }

  if (found < maxParagraphs) return cap;
  if (pos <= start) return cap;
  return Math.min(pos, cap);
}

/* ------------------------------------------------------------------ */
/*  Section-specific rationale text                                   */
/* ------------------------------------------------------------------ */

const SCREENING_RATIONALE: Record<string, string> = {
  abstract:
    'Read the abstract first to decide if this paper is relevant to your needs.',
  introduction:
    'Skim the introduction for the problem statement and key contributions.',
  results: 'Check the results to see if findings are significant.',
  conclusion:
    'Read the conclusion for a summary of contributions and takeaways.',
  related_work:
    'Scan related work to understand how this fits in the literature.',
  background:
    'Skim background for prerequisite concepts you may need.',
  experiments:
    'Glance at experiments for setup and evaluation approach.',
};

const STUDY_RATIONALE: Record<string, string> = {
  abstract:
    'Start with the abstract to frame the full paper context.',
  introduction:
    'Read the introduction closely for motivation, problem definition, and contributions.',
  background:
    'Study background to build prerequisite knowledge.',
  related_work:
    'Understand prior work and how this paper positions itself.',
  methods:
    'Study methods in detail — this is the core technical contribution.',
  experiments:
    'Examine experimental setup, datasets, baselines, and evaluation protocol.',
  results:
    'Analyze results, tables, and figures for evidence.',
  discussion:
    'Read the discussion for interpretation, implications, and open questions.',
  limitations:
    'Note limitations and potential weaknesses in the approach.',
  conclusion:
    'Review the conclusion for a summary and future directions.',
};

function rationaleForGoal(
  goal: ReadingGoal,
  sec: Section,
  custom?: string,
): { rationale: string; priority: 'high' | 'medium' | 'low' } {
  if (goal === 'screening') {
    const p = screeningPriority(sec.normalizedTitle);
    return {
      rationale:
        SCREENING_RATIONALE[sec.normalizedTitle] ??
        'Skim this section for relevance and main takeaways.',
      priority: p <= 1 ? 'high' : p <= 4 ? 'medium' : 'low',
    };
  }
  if (goal === 'study') {
    const p = studyPriority(sec.normalizedTitle);
    return {
      rationale:
        STUDY_RATIONALE[sec.normalizedTitle] ??
        'Read this section carefully for details and evidence.',
      priority: p <= 2 ? 'high' : p <= 5 ? 'medium' : 'low',
    };
  }

  // Custom goal
  const snippet = custom?.trim().slice(0, 72) ?? '';
  const titleLower = sec.title.toLowerCase();
  const tokens = tokenize(snippet);
  const titleMatchCount = tokens.filter((t) =>
    titleLower.includes(t),
  ).length;

  let priority: 'high' | 'medium' | 'low';
  let rationale: string;

  if (titleMatchCount >= 2) {
    priority = 'high';
    rationale = `This section title directly matches your goal.`;
  } else if (titleMatchCount === 1) {
    priority = 'high';
    rationale = `Section title contains key term from your goal.`;
  } else {
    priority = 'medium';
    rationale = snippet
      ? `Content relevant to: "${snippet}${snippet.length >= 72 ? '…' : ''}"`
      : 'Matches your custom reading goal.';
  }

  return { rationale, priority };
}

/* ------------------------------------------------------------------ */
/*  Main pipeline                                                     */
/* ------------------------------------------------------------------ */

/**
 * Single client-side pipeline: filter sections by goal, order, then
 * build spans from PDF.js structure.
 */
export function buildReadingPath(
  structure: DocumentStructure,
  goal: ReadingGoal,
  customDescription?: string,
): { steps: ReadingPathStep[]; highlights: TextSpan[] } {
  const { fullText } = structure;
  const filtered = filterSectionsForGoal(
    structure.sections,
    goal,
    customDescription,
  );
  const ordered = sortSectionsForGoal(filtered, goal);

  const steps: ReadingPathStep[] = [];
  const highlights: TextSpan[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const sec = ordered[i];
    const rawStart = sec.startCharGlobal;
    const start = snapToParagraphStart(fullText, rawStart, sec.startCharGlobal, sec.endCharGlobal);
    const isAbstract = sec.normalizedTitle === 'abstract';

    // More generous paragraph/char limits
    let maxParas: number;
    let maxChars: number;
    if (isAbstract) {
      maxParas = 2;
      maxChars = 4000;
    } else if (goal === 'screening') {
      maxParas = 3;
      maxChars = 1600;
    } else if (goal === 'study') {
      maxParas = 5;
      maxChars = DEFAULT_MAX_SPAN_CHARS;
    } else {
      // Custom: show more of the matched section
      maxParas = 5;
      maxChars = DEFAULT_MAX_SPAN_CHARS;
    }

    const end = endAfterParagraphs(
      fullText,
      start,
      sec.endCharGlobal,
      maxParas,
      maxChars,
    );

    if (end <= start) continue;

    const { rationale, priority } = rationaleForGoal(
      goal,
      sec,
      customDescription,
    );

    const span = spanFromCharRange(structure, start, end, `path-${i}`);
    if (!span || span.rects.length === 0) continue;

    const hlEnd = Math.min(end, sec.endCharGlobal);
    const hlSpans = highlightSpansFromCharRange(structure, start, hlEnd, `hl-${i}`);
    for (const hl of hlSpans) {
      if (hl.rects.length > 0) highlights.push(hl);
    }

    steps.push({
      order: steps.length,
      sectionTitle: sec.title,
      rationale,
      priority,
      span,
    });
  }

  // Re-number after filtering
  steps.forEach((s, idx) => {
    s.order = idx;
  });

  return { steps, highlights };
}
