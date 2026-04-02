import type { DocumentStructure } from '../../types/aura';

/** Sliding window around a character offset for LLM explanation context. */
export function localContext(structure: DocumentStructure, centerChar: number, windowSize = 800): string {
  const { fullText } = structure;
  const lo = Math.max(0, centerChar - windowSize / 2);
  const hi = Math.min(fullText.length, centerChar + windowSize / 2);
  return fullText.slice(lo, hi).trim();
}
