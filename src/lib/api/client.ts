const BASE = '';

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

export interface ParseResponse {
  doc_id: string;
  full_text: string;
  metadata: {
    title?: string;
    abstract?: string;
    authors?: string[];
  };
  sections: Array<{
    id: string;
    title: string;
    text: string;
    start_char: number;
    end_char: number;
  }>;
  paragraphs: Array<{
    id: string;
    text: string;
    start_char: number;
    end_char: number;
  }>;
  citations: Array<{ id: string; raw_text: string }>;
  figures: Array<{ id: string; caption: string }>;
  tables: Array<{ id: string; caption: string }>;
}

export interface ExplainResponse {
  explanation: string;
  confidence: number;
}

export interface QueryResponse {
  answer: string;
  confidence: number;
}

export interface CompareAlignedSection {
  left_index: number;
  right_index: number;
  left_title: string;
  right_title: string;
  similarity: number;
}

export interface CompareDifference {
  type: string;
  description: string;
  left_excerpt: string;
  right_excerpt: string;
}

export interface CompareResponse {
  aligned_sections: CompareAlignedSection[];
  differences: CompareDifference[];
}

export interface ResolvedReference {
  index: number;
  raw_text: string;
  resolved: boolean;
  paper_id: string | null;
  title: string | null;
  authors: string[] | null;
  year: number | null;
  abstract: string | null;
  open_access_pdf_url: string | null;
  semantic_scholar_url: string | null;
}

export interface ExtractReferencesResponse {
  references: ResolvedReference[];
}

export interface HighlightExcerpt {
  text: string;
  section: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
}

export interface HighlightsResponse {
  highlights: HighlightExcerpt[];
}

export const api = {
  parse(file: File): Promise<ParseResponse> {
    return upload('/api/parse', file);
  },

  explain(
    docId: string,
    selectedText: string,
    contextParagraph: string,
    mode: 'plain' | 'eli5' | 'detailed' = 'plain',
  ): Promise<ExplainResponse> {
    return post('/api/explain', {
      doc_id: docId,
      selected_text: selectedText,
      context_paragraph: contextParagraph,
      mode,
    });
  },

  query(docId: string, question: string): Promise<QueryResponse> {
    return post('/api/query', { doc_id: docId, question });
  },

  compare(
    docIdLeft: string,
    docIdRight: string,
    template: string = 'full_parallel',
  ): Promise<CompareResponse> {
    return post('/api/compare', {
      doc_id_left: docIdLeft,
      doc_id_right: docIdRight,
      template,
    });
  },

  extractReferences(docId: string): Promise<ExtractReferencesResponse> {
    return post('/api/extract-references', { doc_id: docId });
  },

  getHighlights(
    docId: string,
    goal: string,
    customGoal?: string,
    clientText?: string,
  ): Promise<HighlightsResponse> {
    const body: Record<string, unknown> = { doc_id: docId, goal };
    if (customGoal) body.custom_goal = customGoal;
    if (clientText) body.client_text = clientText;
    return post('/api/highlights', body);
  },

  async fetchReferencePdf(
    paperId: string,
    pdfUrl?: string,
  ): Promise<{ blob: Blob; docId: string | null }> {
    const res = await fetch(`${BASE}/api/fetch-reference-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper_id: paperId, pdf_url: pdfUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `API error ${res.status}`);
    }
    const blob = await res.blob();
    const docId = res.headers.get('X-Doc-Id') || null;
    return { blob, docId };
  },
};
