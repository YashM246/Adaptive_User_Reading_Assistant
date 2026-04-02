import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem as PdfTextItem } from 'pdfjs-dist/types/src/display/api';
import type { DocumentStructure, PageText, Rect, TextChunk, TextItem, TextSpan } from '../../types/aura';
import { chunkByParagraphs, parseSections } from './parseSections';

function itemRect(
  viewport: pdfjsLib.PageViewport,
  item: PdfTextItem
): Rect {
  const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const x = transform[4];
  const y = transform[5];
  const fontHeight = Math.hypot(transform[2], transform[3]) || 10;
  const rd = viewport.rawDims as { pageWidth: number; pageHeight: number };
  const pageW = rd.pageWidth || viewport.width;
  // TextItem.width is in PDF user space (same units as page width). transform[4]/[5] are viewport pixels — scale width to match.
  const width = item.width * (viewport.width / pageW);
  return {
    x,
    y: y - fontHeight,
    width,
    height: fontHeight,
  };
}

/**
 * Group rects that share the same visual line (similar y + height) into
 * contiguous runs, then merge each run. A large horizontal gap between
 * items on the same line (e.g. two-column layout) produces separate
 * rects instead of one rect spanning the full page width.
 */
function groupRectsIntoLines(rects: Rect[]): Rect[] {
  if (rects.length === 0) return [];

  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: Rect[][] = [];
  let currentRow: Rect[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentRow[0];
    const curr = sorted[i];
    const verticalOverlap = Math.min(prev.y + prev.height, curr.y + curr.height) - Math.max(prev.y, curr.y);
    const isSameLine = verticalOverlap > Math.min(prev.height, curr.height) * 0.5;

    if (isSameLine) {
      currentRow.push(curr);
    } else {
      rows.push(currentRow);
      currentRow = [curr];
    }
  }
  rows.push(currentRow);

  const result: Rect[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);

    const runs: Rect[][] = [[row[0]]];
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1];
      const curr = row[i];
      const gap = curr.x - (prev.x + prev.width);
      const avgHeight = (prev.height + curr.height) / 2;
      if (gap > avgHeight * 3) {
        runs.push([curr]);
      } else {
        runs[runs.length - 1].push(curr);
      }
    }

    for (const run of runs) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const r of run) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }
      result.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    }
  }

  return result;
}

export async function extractPdfStructure(
  pdf: PDFDocumentProxy,
  scale = 1.5
): Promise<DocumentStructure> {
  const numPages = pdf.numPages;
  const pages: PageText[] = [];
  const pageCharOffsets: number[] = [];
  let fullText = '';
  let globalChar = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    pageCharOffsets.push(globalChar);
    if (pageNum % 3 === 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const textContent = await page.getTextContent();
    const items: TextItem[] = [];

    let prevRect: Rect | null = null;
    let firstOnPage = true;

    for (const raw of textContent.items) {
      if (!('str' in raw) || !raw.str) continue;
      const str = raw.str;
      const rect = itemRect(viewport, raw as PdfTextItem);

      if (!firstOnPage && prevRect) {
        const verticalGap = rect.y - (prevRect.y + prevRect.height);
        const lineHeight = prevRect.height || 10;

        if (verticalGap > lineHeight * 1.2) {
          fullText += '\n\n';
          globalChar += 2;
        } else if (verticalGap > lineHeight * 0.3 || Math.abs(rect.y - prevRect.y) > lineHeight * 0.6) {
          fullText += '\n';
          globalChar += 1;
        } else {
          fullText += ' ';
          globalChar += 1;
        }
      }
      firstOnPage = false;

      const start = globalChar;
      fullText += str;
      globalChar += str.length;
      const end = globalChar;
      items.push({
        text: str,
        rect,
        globalCharStart: start,
        globalCharEnd: end,
      });
      prevRect = rect;
    }

    if (pageNum < numPages) {
      fullText += '\n\n';
      globalChar += 2;
    }

    pages.push({
      pageIndex: pageNum - 1,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      items,
    });
  }

  const sections = parseSections(fullText);
  const paraChunks = chunkByParagraphs(fullText);
  const chunks: TextChunk[] = paraChunks.map((c, i) => ({
    id: `chunk-${i}`,
    startCharGlobal: c.start,
    endCharGlobal: c.end,
    text: c.text,
  }));

  return {
    numPages,
    scale,
    pages,
    fullText,
    pageCharOffsets,
    sections,
    chunks,
  };
}

/**
 * Find the page index where `charPos` falls.
 */
function pageForChar(pageCharOffsets: number[], charPos: number): number {
  for (let i = pageCharOffsets.length - 1; i >= 0; i--) {
    if (charPos >= pageCharOffsets[i]) return i;
  }
  return 0;
}

/**
 * Build a TextSpan for a character range on its starting page.
 * Returns per-line rects so highlights follow individual text lines
 * rather than covering the entire bounding region.
 */
export function spanFromCharRange(
  structure: DocumentStructure,
  start: number,
  end: number,
  id: string,
): TextSpan | null {
  const { pages, pageCharOffsets, fullText } = structure;
  const pageIndex = pageForChar(pageCharOffsets, start);
  const page = pages[pageIndex];
  if (!page) return null;

  const matchedRects: Rect[] = [];
  for (const it of page.items) {
    const overlap =
      Math.max(
        0,
        Math.min(end, it.globalCharEnd) - Math.max(start, it.globalCharStart),
      );
    if (overlap > 0) matchedRects.push(it.rect);
  }
  if (matchedRects.length === 0) return null;

  const rects = groupRectsIntoLines(matchedRects);
  const text = fullText.slice(start, Math.min(end, fullText.length));
  return {
    id,
    pageIndex,
    rects,
    text: text.trim(),
  };
}

/**
 * Like `spanFromCharRange`, but returns one TextSpan per page that the
 * range overlaps.  This is needed for highlights that cross page
 * boundaries — the UI filters highlights by `pageIndex`, so each page
 * needs its own span.
 */
export function highlightSpansFromCharRange(
  structure: DocumentStructure,
  start: number,
  end: number,
  idPrefix: string,
): TextSpan[] {
  const { pages, pageCharOffsets, fullText } = structure;
  const startPage = pageForChar(pageCharOffsets, start);
  const endPage = pageForChar(pageCharOffsets, Math.max(start, end - 1));

  const spans: TextSpan[] = [];

  for (let p = startPage; p <= endPage; p++) {
    const page = pages[p];
    if (!page) continue;

    const matchedRects: Rect[] = [];
    for (const it of page.items) {
      const overlap =
        Math.max(
          0,
          Math.min(end, it.globalCharEnd) - Math.max(start, it.globalCharStart),
        );
      if (overlap > 0) matchedRects.push(it.rect);
    }
    if (matchedRects.length === 0) continue;

    const rects = groupRectsIntoLines(matchedRects);
    const pageStart = pageCharOffsets[p];
    const pageEnd =
      p + 1 < pageCharOffsets.length ? pageCharOffsets[p + 1] : fullText.length;
    const textStart = Math.max(start, pageStart);
    const textEnd = Math.min(end, pageEnd);
    const text = fullText.slice(textStart, textEnd);

    spans.push({
      id: startPage === endPage ? idPrefix : `${idPrefix}-p${p}`,
      pageIndex: p,
      rects,
      text: text.trim(),
    });
  }

  return spans;
}
