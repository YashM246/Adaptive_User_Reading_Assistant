import type { DocumentStructure } from '../../types/aura';

export function findFirstDefinitionOffset(fullText: string, term: string): number {
  const t = term.trim();
  if (t.length < 2) return -1;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  const m = re.exec(fullText);
  return m ? m.index : -1;
}

export function localContext(structure: DocumentStructure, centerChar: number, windowSize = 800): string {
  const { fullText } = structure;
  const lo = Math.max(0, centerChar - windowSize / 2);
  const hi = Math.min(fullText.length, centerChar + windowSize / 2);
  return fullText.slice(lo, hi).trim();
}
