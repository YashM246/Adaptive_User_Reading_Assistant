import type { TextSpan } from '../../types/aura';

export function scrollToSpan(root: HTMLElement | null, span: TextSpan): void {
  if (!root) return;
  const el = root.querySelector(`[data-page="${span.pageIndex}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
