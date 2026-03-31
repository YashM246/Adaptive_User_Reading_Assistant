from flask import Blueprint, request, jsonify

from backend.services import document_store
from backend.services.llm import chat

bp = Blueprint('explain', __name__)

MODE_INSTRUCTIONS = {
    'plain': 'Explain the passage in clear, accessible language for a graduate student.',
    'eli5': 'Explain the passage as if talking to a curious 10-year-old. Use simple words and analogies.',
    'detailed': 'Give a detailed technical explanation, including any prerequisite concepts needed to fully understand the passage.',
}


@bp.route('/api/explain', methods=['POST'])
def explain():
    body = request.get_json(silent=True) or {}
    doc_id = body.get('doc_id', '')
    selected_text = body.get('selected_text', '')
    context = body.get('context_paragraph', '')
    mode = body.get('mode', 'plain')

    if not selected_text:
        return jsonify({'error': 'No text selected'}), 400

    doc = document_store.get(doc_id)
    paper_context = ''
    if doc:
        meta = doc.get('metadata', {})
        title = meta.get('title', 'Unknown paper')
        abstract = meta.get('abstract', '')[:500]
        paper_context = f'Paper title: {title}\nAbstract: {abstract}\n'

    instruction = MODE_INSTRUCTIONS.get(mode, MODE_INSTRUCTIONS['plain'])

    system = f"""You are an academic reading assistant embedded inside a PDF reader.
{instruction}
Also provide a confidence score from 0.0 to 1.0 indicating how confident you are in the explanation.
Format your response as:
EXPLANATION: <your explanation>
CONFIDENCE: <0.0-1.0>"""

    user_msg = f"""{paper_context}
Context paragraph:
{context[:1500]}

Selected passage to explain:
{selected_text[:2000]}"""

    try:
        raw = chat(system, user_msg)
    except Exception as e:
        return jsonify({'error': f'LLM call failed: {e}'}), 502

    explanation, confidence = _parse_response(raw)
    return jsonify({'explanation': explanation, 'confidence': confidence})


def _parse_response(raw: str) -> tuple[str, float]:
    explanation = raw
    confidence = 0.7

    if 'EXPLANATION:' in raw:
        parts = raw.split('CONFIDENCE:')
        explanation = parts[0].replace('EXPLANATION:', '').strip()
        if len(parts) > 1:
            try:
                confidence = float(parts[1].strip()[:4])
                confidence = max(0.0, min(1.0, confidence))
            except ValueError:
                pass

    return explanation, confidence
