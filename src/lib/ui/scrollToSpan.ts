import type { TextSpan } from '../../types/aura';

/**
 * Scroll the reader column so that the first highlight rect of the
 * given span is visible.  Falls back to centering the whole page if
 * the rect cannot be located in the DOM.
 */
export function scrollToSpan(root: HTMLElement | null, span: TextSpan): void {
  if (!root) return;

  const pageEl = root.querySelector<HTMLElement>(
    `[data-page="${span.pageIndex}"]`,
  );
  if (!pageEl) return;

  // Try to compute the offset of the first highlight rect relative to
  // the scroll container so we can scroll to a precise position.
  if (span.rects.length > 0) {
    const firstRect = span.rects[0];
    const pageRect = pageEl.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();

    // The highlight rect coords are relative to the page viewport.
    // Compute the absolute position of the highlight top within the
    // scroll container.
    const highlightTopInRoot =
      pageRect.top - rootRect.top + root.scrollTop + firstRect.y;

    // Scroll so the highlight sits roughly 1/3 from the top of the
    // viewport for comfortable reading.
    const target = highlightTopInRoot - root.clientHeight / 3;
    root.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    return;
  }

  // Fallback: scroll to page center
  pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
