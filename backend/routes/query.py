from flask import Blueprint, request, jsonify

from backend.services import document_store
from backend.services.llm import chat

bp = Blueprint('query', __name__)


@bp.route('/api/query', methods=['POST'])
def query():
    body = request.get_json(silent=True) or {}
    doc_id = body.get('doc_id', '')
    question = body.get('question', '')

    if not question:
        return jsonify({'error': 'No question provided'}), 400

    doc = document_store.get(doc_id)
    if doc is None:
        return jsonify({'error': 'Document not found'}), 404

    paper_chunks = _relevant_chunks(doc, question)

    system = """You are an academic reading assistant. Answer the user's question about the paper.
Be concise, accurate, and cite specific sections when possible.
Also provide a confidence score from 0.0 to 1.0.
Format:
ANSWER: <your answer>
CONFIDENCE: <0.0-1.0>"""

    meta = doc.get('metadata', {})
    title = meta.get('title', 'Unknown')
    user_msg = f"""Paper: {title}

Relevant passages:
{paper_chunks}

Question: {question}"""

    try:
        raw = chat(system, user_msg, max_tokens=2048)
    except Exception as e:
        return jsonify({'error': f'LLM call failed: {e}'}), 502

    answer, confidence = _parse_response(raw)
    return jsonify({'answer': answer, 'confidence': confidence})


def _relevant_chunks(doc: dict, question: str) -> str:
    q_lower = question.lower()
    paragraphs = doc.get('paragraphs', [])
    if not paragraphs:
        return doc.get('full_text', '')[:6000]

    scored = []
    for p in paragraphs:
        text = p.get('text', '')
        words = q_lower.split()
        score = sum(1 for w in words if w in text.lower())
        scored.append((score, text))

    scored.sort(key=lambda x: -x[0])
    chunks = [t for _, t in scored[:8]]
    return '\n---\n'.join(chunks)[:6000]


def _parse_response(raw: str) -> tuple[str, float]:
    answer = raw
    confidence = 0.7
    if 'ANSWER:' in raw:
        parts = raw.split('CONFIDENCE:')
        answer = parts[0].replace('ANSWER:', '').strip()
        if len(parts) > 1:
            try:
                confidence = float(parts[1].strip()[:4])
                confidence = max(0.0, min(1.0, confidence))
            except ValueError:
                pass
    return answer, confidence
