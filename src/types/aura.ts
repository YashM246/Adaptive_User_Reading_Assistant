export type ReadingGoal = 'screening' | 'study' | 'custom';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextItem {
  text: string;
  rect: Rect;
  globalCharStart: number;
  globalCharEnd: number;
}

export interface PageText {
  pageIndex: number;
  viewportWidth: number;
  viewportHeight: number;
  items: TextItem[];
}

export interface TextSpan {
  id: string;
  pageIndex: number;
  rects: Rect[];
  text: string;
}

export interface Section {
  id: string;
  title: string;
  normalizedTitle: string;
  startCharGlobal: number;
  endCharGlobal: number;
  preview: string;
}

export interface ReadingPathStep {
  order: number;
  sectionTitle: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
  span: TextSpan;
}

export interface TextChunk {
  id: string;
  startCharGlobal: number;
  endCharGlobal: number;
  text: string;
}

export interface DocumentStructure {
  numPages: number;
  scale: number;
  pages: PageText[];
  fullText: string;
  pageCharOffsets: number[];
  sections: Section[];
  chunks: TextChunk[];
}
