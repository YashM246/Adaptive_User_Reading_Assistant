import type { DocumentStructure, ReadingGoal, ReadingPathStep, TextSpan } from '../../types/aura';
import { spanFromCharRange } from '../structure/extractPdfStructure';

interface GoalProfile {
  prioritySections: string[];
  keywords: string[];
  sectionRationales: Record<string, string>;
}

const GOAL_PROFILES: Record<ReadingGoal, GoalProfile> = {
  screening: {
    prioritySections: ['abstract', 'introduction', 'conclusion', 'results', 'experiments'],
    keywords: ['abstract', 'contribution', 'novel', 'outperform', 'main result', 'summary', 'conclusion', 'we propose', 'we present', 'dataset'],
    sectionRationales: {
      abstract: 'Quick overview of the paper\'s scope, methods, and key findings.',
      introduction: 'Establishes the problem statement and why this work matters.',
      conclusion: 'Summarizes what was achieved and remaining open questions.',
      results: 'Shows whether the approach actually works and how well.',
      experiments: 'Reveals evaluation setup and quantitative outcomes.',
    },
  },
  study: {
    prioritySections: ['abstract', 'introduction', 'background', 'methods', 'results', 'discussion', 'conclusion'],
    keywords: ['theorem', 'lemma', 'proof', 'definition', 'formally', 'proposition', 'we define', 'notation', 'framework'],
    sectionRationales: {
      abstract: 'Frames the full paper for systematic deep reading.',
      introduction: 'Motivation and problem context needed before technical depth.',
      background: 'Prerequisite concepts and notation used throughout.',
      methods: 'Core technical contribution — the approach or algorithm.',
      results: 'Empirical or theoretical validation of the method.',
      discussion: 'Interpretation, limitations, and broader implications.',
      conclusion: 'Final synthesis and future directions.',
    },
  },
  custom: {
    prioritySections: ['abstract', 'introduction', 'methods', 'results', 'conclusion'],
    keywords: ['contribution', 'method', 'result', 'experiment', 'approach', 'propose'],
    sectionRationales: {
      abstract: 'General overview of the paper.',
      introduction: 'Problem context and motivation.',
      methods: 'Technical approach and methodology.',
      results: 'Key findings and outcomes.',
      conclusion: 'Summary and takeaways.',
    },
  },
};

/** Turn free-text reading goals into extra keyword tokens for scoring. */
function tokenizeCustomGoal(text: string): string[] {
  const normalized = text.toLowerCase().replace(/['']/g, '');
  const words = normalized.split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const out = [...new Set(words)];
  const phrases = text.toLowerCase().match(/\b[a-z][a-z\s]{2,40}[a-z]\b/g) ?? [];
  for (const p of phrases) {
    const t = p.trim();
    if (t.length >= 4 && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 35);
}

function resolveProfile(goal: ReadingGoal, customDescription?: string): GoalProfile {
  const base = GOAL_PROFILES[goal];
  if (goal !== 'custom' || !customDescription?.trim()) {
    return base;
  }
  const extra = tokenizeCustomGoal(customDescription.trim());
  return {
    prioritySections: [...base.prioritySections],
    keywords: [...new Set([...base.keywords, ...extra])],
    sectionRationales: { ...base.sectionRationales },
  };
}

function matchSection(normalizedTitle: string, targetNames: string[]): string | null {
  for (const target of targetNames) {
    if (normalizedTitle === target) return target;
    if (normalizedTitle.includes(target) || target.includes(normalizedTitle)) return target;
  }
  return null;
}

function scoreKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (kw.length >= 4 && lower.includes(kw)) score += 2;
    else if (lower.includes(kw)) score += 1;
  }
  return score;
}

function buildFromSections(
  structure: DocumentStructure,
  goal: ReadingGoal,
  profile: GoalProfile,
  customSnippet?: string,
): { steps: ReadingPathStep[]; highlights: TextSpan[] } {
  const { sections } = structure;

  const ranked: {
    section: typeof sections[number];
    priority: 'high' | 'medium' | 'low';
    rationale: string;
    matchedName: string | null;
    keywordScore: number;
  }[] = [];

  for (const sec of sections) {
    if (sec.normalizedTitle === 'document') continue;

    const matchedName = matchSection(sec.normalizedTitle, profile.prioritySections);
    const keywordScore = scoreKeywords(sec.preview, profile.keywords);

    if (matchedName) {
      const priorityIndex = profile.prioritySections.indexOf(matchedName);
      const priority: 'high' | 'medium' | 'low' = priorityIndex < 2 ? 'high' : priorityIndex < 4 ? 'medium' : 'low';
      let rationale = profile.sectionRationales[matchedName] ?? `Relevant to your ${goal} goal.`;
      if (goal === 'custom' && customSnippet?.trim()) {
        rationale = `${rationale} (aligned with your goal: "${customSnippet.trim().slice(0, 80)}${customSnippet.trim().length > 80 ? '…' : ''}")`;
      }
      ranked.push({ section: sec, priority, rationale, matchedName, keywordScore });
    } else if (keywordScore > 0) {
      const rationale =
        goal === 'custom' && customSnippet?.trim()
          ? `Matches terms from your goal: "${customSnippet.trim().slice(0, 60)}${customSnippet.trim().length > 60 ? '…' : ''}".`
          : `Contains keywords relevant to your ${goal.replace(/_/g, ' ')} goal.`;
      ranked.push({
        section: sec,
        priority: 'low',
        rationale,
        matchedName: null,
        keywordScore,
      });
    }
  }

  if (ranked.length === 0) return { steps: [], highlights: [] };

  ranked.sort((a, b) => {
    const prioOrder = { high: 0, medium: 1, low: 2 };
    const prioDiff = prioOrder[a.priority] - prioOrder[b.priority];
    if (prioDiff !== 0) return prioDiff;
    if (a.matchedName && b.matchedName) {
      return profile.prioritySections.indexOf(a.matchedName) - profile.prioritySections.indexOf(b.matchedName);
    }
    return b.keywordScore - a.keywordScore;
  });

  const topSteps = ranked.slice(0, 8);
  topSteps.sort((a, b) => a.section.startCharGlobal - b.section.startCharGlobal);

  const steps: ReadingPathStep[] = [];
  const highlights: TextSpan[] = [];

  for (let i = 0; i < topSteps.length; i++) {
    const { section, priority, rationale } = topSteps[i];
    const span = spanFromCharRange(
      structure,
      section.startCharGlobal,
      Math.min(section.startCharGlobal + 500, section.endCharGlobal),
      `path-${i}`
    );
    if (!span) continue;

    const fullSpan = spanFromCharRange(
      structure,
      section.startCharGlobal,
      section.endCharGlobal,
      `hl-${i}`
    );
    if (fullSpan) highlights.push(fullSpan);

    steps.push({ order: i, sectionTitle: section.title, rationale, priority, span });
  }

  return { steps, highlights };
}

function buildFromChunks(
  structure: DocumentStructure,
  goal: ReadingGoal,
  profile: GoalProfile,
  customSnippet?: string,
): { steps: ReadingPathStep[]; highlights: TextSpan[] } {
  const scored = structure.chunks
    .map((c) => ({ chunk: c, score: scoreKeywords(c.text, profile.keywords) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (scored.length === 0) {
    const byLength = [...structure.chunks]
      .filter((c) => c.text.length > 60)
      .slice(0, 6);
    scored.push(...byLength.map((chunk) => ({ chunk, score: 0 })));
  }

  const steps: ReadingPathStep[] = [];
  const highlights: TextSpan[] = [];
  const seen = new Set<string>();

  for (const { chunk, score } of scored) {
    const span = spanFromCharRange(
      structure,
      chunk.startCharGlobal,
      chunk.endCharGlobal,
      `chk-path-${steps.length}`
    );
    if (!span) continue;
    const key = `${span.pageIndex}-${Math.round(span.rects[0]?.y ?? 0)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    highlights.push(span);

    const preview = chunk.text.slice(0, 60).replace(/\s+/g, ' ');
    let rationale: string;
    if (score > 0) {
      if (goal === 'custom' && customSnippet?.trim()) {
        rationale = `Likely relevant to your goal: "${customSnippet.trim().slice(0, 70)}${customSnippet.trim().length > 70 ? '…' : ''}".`;
      } else {
        rationale = `Contains keywords relevant to your ${goal.replace(/_/g, ' ')} goal.`;
      }
    } else {
      rationale = 'Substantive passage worth reading.';
    }

    steps.push({
      order: steps.length,
      sectionTitle: `${preview}…`,
      rationale,
      priority: score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low',
      span,
    });
  }

  steps.sort((a, b) => {
    const aPage = a.span.pageIndex;
    const bPage = b.span.pageIndex;
    if (aPage !== bPage) return aPage - bPage;
    return (a.span.rects[0]?.y ?? 0) - (b.span.rects[0]?.y ?? 0);
  });
  steps.forEach((s, i) => { s.order = i; });

  return { steps, highlights };
}

export function buildReadingPath(
  structure: DocumentStructure,
  goal: ReadingGoal,
  customDescription?: string,
): { steps: ReadingPathStep[]; highlights: TextSpan[] } {
  const profile = resolveProfile(goal, customDescription);
  const customSnippet = goal === 'custom' ? customDescription?.trim() : undefined;

  const fromSections = buildFromSections(structure, goal, profile, customSnippet);
  if (fromSections.steps.length >= 2) {
    return fromSections;
  }

  return buildFromChunks(structure, goal, profile, customSnippet);
}
