import type { Section } from '../../types/aura';

const SECTION_PATTERNS: { re: RegExp; normalized: string }[] = [
  { re: /\babstract\b/i, normalized: 'abstract' },
  { re: /\bintroduction\b/i, normalized: 'introduction' },
  { re: /\brelated\s+work\b/i, normalized: 'related_work' },
  { re: /\bbackground\b/i, normalized: 'background' },
  { re: /\bmethod(s|ology)?\b/i, normalized: 'methods' },
  { re: /\b(model\s+architecture|architecture|approach)\b/i, normalized: 'methods' },
  { re: /\bexperiment(s|al)?(\s+setup)?\b/i, normalized: 'experiments' },
  { re: /\bresult(s)?\b/i, normalized: 'results' },
  { re: /\bdiscussion\b/i, normalized: 'discussion' },
  { re: /\bconclusion(s)?\b/i, normalized: 'conclusion' },
  { re: /\blimitation(s)?\b/i, normalized: 'limitations' },
  { re: /\b(future\s+work)\b/i, normalized: 'limitations' },
  { re: /\breference(s)?\b/i, normalized: 'references' },
  { re: /\bbibliography\b/i, normalized: 'references' },
  { re: /\bappendix\b/i, normalized: 'appendix' },
  { re: /\bevaluation\b/i, normalized: 'experiments' },
  { re: /\banalysis\b/i, normalized: 'results' },
  { re: /\bimplementation\b/i, normalized: 'methods' },
];

/** Detect if a line looks like a citation/bibliography entry rather than a section heading. */
function isReferenceEntry(line: string): boolean {
  const trimmed = line.trim();

  // Matches: "[27] Author et al. Title. Venue, 2020"
  const citePattern = /^\[\d+\]\s+[A-Z][a-z]+(\s+et\s+al\.?)?/i;

  // Matches: "Author, A. (2020). Title..."
  const authorYearPattern = /^[A-Z][a-z]+,\s*[A-Z]\.\s*\(\d{4}\)/;

  // Matches: "A Author. Title. Venue, 2020"
  const authorTitleVenuePattern = /^[A-Z]\s[A-Z][a-z]+\.\s+[^.]+\.\s+[^,]+,\s+\d{4}/;

  // Matches lines that are mostly numbers, brackets, and short words (bibliography style)
  const bibStylePattern = /^(\[\d+\]\s*)?([A-Z][a-z]+,?\s*)+(\d{4})/;

  if (
    citePattern.test(trimmed) ||
    authorYearPattern.test(trimmed) ||
    authorTitleVenuePattern.test(trimmed) ||
    bibStylePattern.test(trimmed)
  ) {
    return true;
  }

  // Check if this looks like a numbered reference list item
  if (/^\d+\.\s+[A-Z]/.test(trimmed) && trimmed.length < 200) {
    // Additional check: does it contain typical citation markers?
    const hasCitationMarkers =
      /\bet al\.?\b/i.test(trimmed) ||
      /\b\d{4}\b/.test(trimmed) ||
      /\b[A-Z][a-z]+\.\s+[A-Z][a-z]+\./.test(trimmed);
    if (hasCitationMarkers) {
      return true;
    }
  }

  return false;
}

function titleFromMatch(match: string): string {
  const t = match.trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/**
 * Score how "heading-like" a line is.  Higher = more likely a heading.
 * Returns 0 if the line should NOT be treated as a heading.
 */
function headingScore(line: string, nextLine: string): number {
  const trimmed = line.trim();
  if (!trimmed) return 0;

  let score = 0;

  // All-caps headings (e.g. "ABSTRACT", "1. INTRODUCTION")
  const letters = trimmed.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 2 && letters === letters.toUpperCase()) score += 4;

  // Starts with a section number like "1.", "2.1", "III."
  if (/^(\d+\.?\s|\d+\.\d+\.?\s|[IVX]+\.?\s)/.test(trimmed)) score += 3;

  // Short line (typical heading length)
  if (trimmed.length <= 40) score += 3;
  else if (trimmed.length <= 60) score += 2;
  else if (trimmed.length <= 80) score += 1;

  // Very long lines are almost never headings
  if (trimmed.length > 100) return 0;

  // Followed by empty line (paragraph break after heading)
  if (!nextLine || nextLine.length === 0) score += 2;

  // No period at end (headings typically don't end with periods)
  if (!trimmed.endsWith('.') || /^\d+\.$/.test(trimmed)) score += 1;

  // Contains a colon (like "3. Results: Main Findings") — still heading-like
  if (/:\s*$/.test(trimmed)) score += 1;

  // Penalize if it looks like a regular sentence (starts lowercase, has commas, etc.)
  if (/^[a-z]/.test(trimmed)) score -= 3;
  if ((trimmed.match(/,/g) || []).length >= 2) score -= 2;

  // Penalize lines that look like body text (lots of words, typical sentence patterns)
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 12) score -= 3;

  return score;
}

/**
 * Minimum heading score threshold.
 * Lines with scores below this are not treated as headings.
 */
const MIN_HEADING_SCORE = 3;

/**
 * Primary strategy: look for section headings that appear on their own
 * line (after a newline), typically short lines matching known patterns.
 */
function parseByLines(
  fullText: string,
): { title: string; normalized: string; charOffset: number }[] {
  const lines = fullText.split(/\n/);
  const found: { title: string; normalized: string; charOffset: number }[] = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = lines[i + 1]?.trim() ?? '';

    if (!line || line.length > 120) {
      offset += lines[i].length + 1;
      continue;
    }

    // Skip if this looks like a citation entry
    if (isReferenceEntry(line)) {
      offset += lines[i].length + 1;
      continue;
    }

    const score = headingScore(line, nextLine);
    if (score < MIN_HEADING_SCORE) {
      offset += lines[i].length + 1;
      continue;
    }

    for (const { re, normalized } of SECTION_PATTERNS) {
      if (re.test(line)) {
        found.push({ title: titleFromMatch(line), normalized, charOffset: offset });
        break;
      }
    }
    offset += lines[i].length + 1;
  }

  return found;
}

/**
 * Fallback strategy: scan the full text with regex for numbered section
 * headings like "1. Introduction", "2 Methods", "3. Experiments" or
 * all-caps headings like "ABSTRACT", "INTRODUCTION".
 */
function parseByRegex(
  fullText: string,
): { title: string; normalized: string; charOffset: number }[] {
  const found: { title: string; normalized: string; charOffset: number }[] = [];
  const seen = new Set<string>();

  // Numbered headings: "1. Introduction", "2 Methods", "3.1 Experiments"
  const numberedRe =
    /(?:^|\n)\s*(\d+(?:\.\d+)?\.?\s+(?:abstract|introduction|related\s+work|background|method(?:s|ology)?|model\s+architecture|architecture|approach|experiment(?:s|al)?(?:\s+setup)?|evaluation|result(?:s)?|analysis|discussion|conclusion(?:s)?|limitation(?:s)?|future\s+work|reference(?:s)?|bibliography|appendix|implementation)[^\n]{0,40})/gi;
  let m: RegExpExecArray | null;
  while ((m = numberedRe.exec(fullText)) !== null) {
    const heading = m[1].trim();
    for (const { re, normalized } of SECTION_PATTERNS) {
      if (re.test(heading) && !seen.has(normalized)) {
        seen.add(normalized);
        found.push({
          title: titleFromMatch(heading),
          normalized,
          charOffset: m.index + m[0].indexOf(m[1]),
        });
        break;
      }
    }
  }

  // ALL-CAPS fallback
  if (found.length < 2) {
    const capsRe =
      /(?:^|\n)\s*((?:ABSTRACT|INTRODUCTION|RELATED\s+WORK|BACKGROUND|METHODS?|METHODOLOGY|EXPERIMENTS?|EVALUATION|RESULTS?|ANALYSIS|DISCUSSION|CONCLUSIONS?|LIMITATIONS?|FUTURE\s+WORK|REFERENCES?|BIBLIOGRAPHY|APPENDIX|IMPLEMENTATION)[^\n]{0,30})/g;
    while ((m = capsRe.exec(fullText)) !== null) {
      const heading = m[1].trim();
      for (const { re, normalized } of SECTION_PATTERNS) {
        if (re.test(heading) && !seen.has(normalized)) {
          seen.add(normalized);
          found.push({
            title: titleFromMatch(heading),
            normalized,
            charOffset: m.index + m[0].indexOf(m[1]),
          });
          break;
        }
      }
    }
  }

  return found;
}

/**
 * Deduplicate sections so that each normalized title appears at most
 * once.  When there are duplicates, keep the one with the best heading
 * (shortest, most heading-like — usually the top-level section, not a
 * subsection like "2.1 Experimental Setup").
 */
function deduplicateByNormalized(
  sections: { title: string; normalized: string; charOffset: number }[],
): typeof sections {
  const map = new Map<string, (typeof sections)[number]>();
  for (const sec of sections) {
    const existing = map.get(sec.normalized);
    if (!existing) {
      map.set(sec.normalized, sec);
      continue;
    }
    // Prefer the earlier occurrence (usually the top-level heading).
    // If the existing one is a subsection (contains "."), prefer the new one if it isn't.
    const existingIsSubsection = /^\d+\.\d+/.test(existing.title.trim());
    const newIsSubsection = /^\d+\.\d+/.test(sec.title.trim());
    if (existingIsSubsection && !newIsSubsection) {
      map.set(sec.normalized, sec);
    }
    // Otherwise keep the first (earlier) occurrence.
  }

  // Return in document order (by charOffset)
  return [...map.values()].sort((a, b) => a.charOffset - b.charOffset);
}

export function parseSections(fullText: string): Section[] {
  let sectionStarts = parseByLines(fullText);

  if (sectionStarts.length < 2) {
    sectionStarts = parseByRegex(fullText);
  }

  if (sectionStarts.length === 0) {
    return [
      {
        id: 'sec-whole',
        title: 'Document',
        normalizedTitle: 'document',
        startCharGlobal: 0,
        endCharGlobal: fullText.length,
        preview: fullText.slice(0, 400),
      },
    ];
  }

  sectionStarts.sort((a, b) => a.charOffset - b.charOffset);

  // Remove entries that are too close together (< 20 chars apart)
  const proximityDeduped: typeof sectionStarts = [];
  for (const s of sectionStarts) {
    if (
      proximityDeduped.length === 0 ||
      s.charOffset - proximityDeduped[proximityDeduped.length - 1].charOffset > 20
    ) {
      proximityDeduped.push(s);
    }
  }

  // Deduplicate by normalized name — keep best candidate for each section type
  const deduped = deduplicateByNormalized(proximityDeduped);

  const sections: Section[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const start = deduped[i].charOffset;
    const end = i + 1 < deduped.length ? deduped[i + 1].charOffset : fullText.length;
    sections.push({
      id: `sec-${i}-${deduped[i].normalized}`,
      title: deduped[i].title,
      normalizedTitle: deduped[i].normalized,
      startCharGlobal: start,
      endCharGlobal: end,
      preview: fullText.slice(start, Math.min(end, start + 400)),
    });
  }

  return sections;
}

export function chunkByParagraphs(
  fullText: string,
): { start: number; end: number; text: string }[] {
  const chunks: { start: number; end: number; text: string }[] = [];
  const parts = fullText.split(/\n\s*\n+/);
  let pos = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length < 20) {
      pos += part.length + 2;
      continue;
    }
    const idx = fullText.indexOf(trimmed, pos);
    if (idx < 0) {
      pos += part.length + 2;
      continue;
    }
    const start = idx;
    const end = idx + trimmed.length;
    chunks.push({ start, end, text: trimmed });
    pos = end;
  }
  if (chunks.length === 0 && fullText.length > 0) {
    chunks.push({ start: 0, end: fullText.length, text: fullText });
  }
  return chunks;
}
