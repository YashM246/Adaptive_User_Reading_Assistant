import type { Section } from '../../types/aura';

const SECTION_PATTERNS: { re: RegExp; normalized: string }[] = [
  { re: /\babstract\b/i, normalized: 'abstract' },
  { re: /\bintroduction\b/i, normalized: 'introduction' },
  { re: /\brelated work\b/i, normalized: 'related_work' },
  { re: /\bbackground\b/i, normalized: 'background' },
  { re: /\bmethod(s|ology)?\b/i, normalized: 'methods' },
  { re: /\bexperiment(s|al)?\b/i, normalized: 'experiments' },
  { re: /\bresult(s)?\b/i, normalized: 'results' },
  { re: /\bdiscussion\b/i, normalized: 'discussion' },
  { re: /\bconclusion(s)?\b/i, normalized: 'conclusion' },
  { re: /\blimitation(s)?\b/i, normalized: 'limitations' },
  { re: /\breference(s)?\b/i, normalized: 'references' },
  { re: /\bappendix\b/i, normalized: 'appendix' },
];

function titleFromMatch(match: string): string {
  const t = match.trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/**
 * Primary strategy: look for section headings that appear on their own
 * line (after a newline), typically short lines matching known patterns.
 */
function parseByLines(fullText: string): { title: string; normalized: string; charOffset: number }[] {
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

    for (const { re, normalized } of SECTION_PATTERNS) {
      if (re.test(line) && (line.length < 80 || /^[\d.\s]*$/u.test(line))) {
        const looksLikeHeading =
          line === line.toUpperCase() ||
          /^(\d+\.?\s*)?(abstract|introduction|method|result|discussion|conclusion|reference|experiment|limitation|background|related)/i.test(line) ||
          line.length < 60;
        if (looksLikeHeading || nextLine.length === 0) {
          found.push({ title: titleFromMatch(line), normalized, charOffset: offset });
          break;
        }
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
function parseByRegex(fullText: string): { title: string; normalized: string; charOffset: number }[] {
  const found: { title: string; normalized: string; charOffset: number }[] = [];
  const seen = new Set<string>();

  const numberedRe = /(?:^|\n)\s*(\d+\.?\s+(?:abstract|introduction|related work|background|method(?:s|ology)?|experiment(?:s|al)?|result(?:s)?|discussion|conclusion(?:s)?|limitation(?:s)?|reference(?:s)?|appendix)[^\n]{0,40})/gi;
  let m: RegExpExecArray | null;
  while ((m = numberedRe.exec(fullText)) !== null) {
    const heading = m[1].trim();
    for (const { re, normalized } of SECTION_PATTERNS) {
      if (re.test(heading) && !seen.has(normalized)) {
        seen.add(normalized);
        found.push({ title: titleFromMatch(heading), normalized, charOffset: m.index + m[0].indexOf(m[1]) });
        break;
      }
    }
  }

  if (found.length < 2) {
    const capsRe = /(?:^|\n)\s*((?:ABSTRACT|INTRODUCTION|RELATED WORK|BACKGROUND|METHODS?|METHODOLOGY|EXPERIMENTS?|RESULTS?|DISCUSSION|CONCLUSIONS?|LIMITATIONS?|REFERENCES?|APPENDIX)[^\n]{0,30})/g;
    while ((m = capsRe.exec(fullText)) !== null) {
      const heading = m[1].trim();
      for (const { re, normalized } of SECTION_PATTERNS) {
        if (re.test(heading) && !seen.has(normalized)) {
          seen.add(normalized);
          found.push({ title: titleFromMatch(heading), normalized, charOffset: m.index + m[0].indexOf(m[1]) });
          break;
        }
      }
    }
  }

  return found;
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
        preview: fullText.slice(0, 200),
      },
    ];
  }

  sectionStarts.sort((a, b) => a.charOffset - b.charOffset);
  const deduped: typeof sectionStarts = [];
  for (const s of sectionStarts) {
    if (
      deduped.length === 0 ||
      s.charOffset - deduped[deduped.length - 1].charOffset > 20
    ) {
      deduped.push(s);
    }
  }

  const sections: Section[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const start = deduped[i].charOffset;
    const end =
      i + 1 < deduped.length ? deduped[i + 1].charOffset : fullText.length;
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

export function chunkByParagraphs(fullText: string): { start: number; end: number; text: string }[] {
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
