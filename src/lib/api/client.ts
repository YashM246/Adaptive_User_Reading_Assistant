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
};
