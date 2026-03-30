# AURA — Execution Plan

This document is the single source of truth for implementing AURA. It is written to be followed step-by-step, either by a developer or by Claude Code. Each phase has a clear goal, concrete tasks, and a definition of done so you always know when a phase is complete before moving to the next.

---

## Prerequisites

Before starting, confirm the following are installed on your machine:

- Node.js >= 18
- Python >= 3.10
- pip
- git
- An OpenAI API key (GPT-4.1 mini access)

---

## Phase 0 — Repository Setup

**Goal:** Get a working project skeleton with the frontend and backend in place.

### 0.1 Fork and clone PaperCraft

```bash
# Clone the Allen AI PDF component library (PaperCraft)
git clone https://github.com/allenai/pdf-component-library.git aura
cd aura

# Rename origin so you can track upstream separately
git remote rename origin upstream
git remote add origin <your-own-github-repo-url>
```

### 0.2 Explore the PaperCraft structure

Before touching anything, spend 5 minutes reading:
- `ui/demo/src/` — this is the demo app; it shows how components are wired together
- `ui/library/src/components/` — these are the core PDF components you will build on top of
- `ui/demo/src/SimpleBookmarks.tsx` — a good example of how the sidebar is used

### 0.3 Install frontend dependencies

```bash
cd ui
npm install
```

### 0.4 Confirm the baseline reader runs

```bash
cd ui
npm run start
# Open http://localhost:3000 and verify a PDF reader loads
```

If it does not load, check the README in the PaperCraft repo for any additional setup steps.

### 0.5 Create the backend directory

```bash
# From the project root
mkdir backend
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
```

### 0.6 Create backend/requirements.txt

```
flask
flask-cors
openai
papermage
python-dotenv
```

```bash
pip install -r requirements.txt
```

> **Note on PaperMage:** If `pip install papermage` fails, install it from source:
> ```bash
> pip install "papermage[all] @ git+https://github.com/allenai/papermage.git"
> ```
> PaperMage requires Java for GROBID. If Java is not installed, install it first:
> ```bash
> # macOS
> brew install openjdk
> # Ubuntu
> sudo apt-get install default-jdk
> ```

### 0.7 Create a .env file in the backend directory

```
OPENAI_API_KEY=your_key_here
```

Add `.env` to `.gitignore` immediately.

**Phase 0 is done when:** the frontend loads a PDF at localhost:3000 and the backend virtual environment is active with all packages installed.

---

## Phase 1 — Backend: PDF Parsing Endpoint

**Goal:** A working Flask endpoint that accepts a PDF upload and returns structured sections as JSON.

### 1.1 Create backend/parse.py

This module wraps PaperMage to extract structured sections from a PDF.

```python
# backend/parse.py
from papermage.recipes import CoreRecipe

def parse_pdf(pdf_path: str) -> list[dict]:
    """
    Parse a PDF using PaperMage and return a list of sections.
    Each section is a dict with keys: title, text, page_start, page_end.
    Falls back to heading-based splitting if PaperMage structured parse fails.
    """
    try:
        recipe = CoreRecipe()
        doc = recipe.run(pdf_path)

        sections = []
        for section in doc.sections:
            sections.append({
                "title": section.metadata.get("title", "Untitled Section"),
                "text": " ".join([p.text for p in section.paragraphs]),
                "page_start": section.boxes[0].page if section.boxes else 0,
                "page_end": section.boxes[-1].page if section.boxes else 0,
            })
        return sections

    except Exception as e:
        # Fallback: return full text as a single section
        print(f"PaperMage structured parse failed: {e}. Using fallback.")
        return fallback_parse(pdf_path)


def fallback_parse(pdf_path: str) -> list[dict]:
    """
    Fallback parser: splits PDF text by lines that look like headings
    (short lines, title-cased or all-caps).
    """
    import pdfplumber

    sections = []
    current_title = "Introduction"
    current_text = []
    current_page = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            for line in text.split("\n"):
                stripped = line.strip()
                if not stripped:
                    continue
                # Heuristic: short lines (<= 60 chars) that are title-cased = heading
                is_heading = (
                    len(stripped) <= 60
                    and (stripped.istitle() or stripped.isupper())
                    and not stripped.endswith(".")
                )
                if is_heading and current_text:
                    sections.append({
                        "title": current_title,
                        "text": " ".join(current_text),
                        "page_start": current_page,
                        "page_end": page_num,
                    })
                    current_title = stripped
                    current_text = []
                    current_page = page_num
                else:
                    current_text.append(stripped)

    # Append last section
    if current_text:
        sections.append({
            "title": current_title,
            "text": " ".join(current_text),
            "page_start": current_page,
            "page_end": current_page,
        })

    return sections
```

> **Note:** Add `pdfplumber` to requirements.txt.

### 1.2 Create backend/app.py with the parse endpoint

```python
# backend/app.py
import os
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from parse import parse_pdf
from llm import generate_reading_path, generate_explanation

load_dotenv()

app = Flask(__name__)
CORS(app)  # Allow requests from the React frontend on localhost:3000


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/parse", methods=["POST"])
def parse():
    """
    Accepts a PDF file upload.
    Returns structured sections as JSON.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename.endswith(".pdf"):
        return jsonify({"error": "File must be a PDF"}), 400

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        sections = parse_pdf(tmp_path)
        return jsonify({"sections": sections})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


@app.route("/api/generate-path", methods=["POST"])
def generate_path():
    """
    Accepts: { goal: string, sections: list }
    Returns: { path: list of steps }
    """
    data = request.json
    if not data or "goal" not in data or "sections" not in data:
        return jsonify({"error": "Missing goal or sections"}), 400

    try:
        path = generate_reading_path(data["goal"], data["sections"])
        return jsonify({"path": path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/explain", methods=["POST"])
def explain():
    """
    Accepts: { selected_text: string, context: string, section: string }
    Returns: { explanation: string }
    """
    data = request.json
    if not data or "selected_text" not in data:
        return jsonify({"error": "Missing selected_text"}), 400

    try:
        explanation = generate_explanation(
            data["selected_text"],
            data.get("context", ""),
            data.get("section", "")
        )
        return jsonify({"explanation": explanation})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5001)
```

### 1.3 Test the parse endpoint manually

```bash
cd backend
source venv/bin/activate
python app.py
# In a separate terminal:
curl -X POST http://localhost:5001/api/parse \
  -F "file=@/path/to/any/paper.pdf"
# Should return JSON with a "sections" array
```

**Phase 1 is done when:** `/api/parse` returns a non-empty sections array for a real PDF.

---

## Phase 2 — Backend: LLM Calls

**Goal:** Two working LLM functions — one for reading path generation, one for inline explanation.

### 2.1 Create backend/llm.py

```python
# backend/llm.py
import os
import json
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = "gpt-4.1-mini"


def generate_reading_path(goal: str, sections: list[dict]) -> list[dict]:
    """
    Given a user goal and list of paper sections, return a ranked reading path.
    Each step: { step, section, rationale, page_ref }
    """
    sections_text = "\n".join([
        f"- {s['title']} (p.{s['page_start']}–{s['page_end']}): {s['text'][:300]}..."
        for s in sections
    ])

    prompt = f"""You are a reading assistant for academic research papers.

Given the following paper sections and a user reading goal, return a JSON reading path.
Select the 3 to 5 most relevant sections for the goal. Order them by the recommended reading sequence.

User goal: {goal}

Paper sections:
{sections_text}

Respond ONLY with a valid JSON object. No explanation, no markdown, no backticks.
Format:
{{
  "path": [
    {{
      "step": 1,
      "section": "Methods",
      "rationale": "Most relevant for replicating the experiment",
      "page_ref": "p.3-5"
    }}
  ],
  "confidence": 0.87
}}"""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=1000,
    )

    raw = response.choices[0].message.content.strip()

    try:
        data = json.loads(raw)
        return data.get("path", [])
    except json.JSONDecodeError:
        # If JSON parsing fails, return a safe fallback
        return [{"step": 1, "section": sections[0]["title"] if sections else "Abstract",
                 "rationale": "Could not generate path — showing first section.",
                 "page_ref": "p.1"}]


def generate_explanation(selected_text: str, context: str, section: str) -> str:
    """
    Given selected text and surrounding context, return a plain-language explanation.
    """
    prompt = f"""You are a reading assistant helping a non-native English speaking researcher understand a passage from an academic paper.

Explain the selected text in plain language using only the context of this paper. Be concise — 2 to 3 sentences maximum. Do not introduce information from outside the paper.

Section: {section}
Surrounding context: {context[:500]}
Selected text: {selected_text}

Respond with only the explanation. No preamble."""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=200,
    )

    return response.choices[0].message.content.strip()
```

### 2.2 Test both LLM endpoints

```bash
# Test path generation
curl -X POST http://localhost:5001/api/generate-path \
  -H "Content-Type: application/json" \
  -d '{"goal": "replicate the experiment", "sections": [{"title": "Methods", "text": "We trained a model...", "page_start": 3, "page_end": 5}]}'

# Test explanation
curl -X POST http://localhost:5001/api/explain \
  -H "Content-Type: application/json" \
  -d '{"selected_text": "stochastic gradient descent", "context": "We used SGD to optimize the model weights", "section": "Methods"}'
```

**Phase 2 is done when:** both endpoints return sensible, non-error JSON responses.

---

## Phase 3 — Frontend: PDF Upload and Baseline Reader

**Goal:** User can upload a PDF and see it rendered in the PaperCraft reader. Parsed sections are stored in app state.

### 3.1 Understand PaperCraft's core components

Before writing any code, read these files in the cloned repo:
- `ui/library/src/components/DocumentWrapper.tsx` — wraps the PDF document
- `ui/library/src/components/PageWrapper.tsx` — renders individual pages
- `ui/demo/src/App.tsx` — shows a minimal wiring example

The key pattern is:
```jsx
<DocumentWrapper file={pdfUrl}>
  <PageWrapper pageIndex={0}>
    {/* overlays go here */}
  </PageWrapper>
</DocumentWrapper>
```

### 3.2 Create the main AURA app component

Create `ui/demo/src/AuraApp.jsx`:

```jsx
import React, { useState, useCallback } from 'react';
import { DocumentWrapper, PageWrapper } from '@allenai/pdf-components';
import GoalModal from './components/GoalModal';
import ReadingPathPanel from './components/ReadingPathPanel';
import ExplanationPanel from './components/ExplanationPanel';

const BACKEND = 'http://localhost:5001';

export default function AuraApp() {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [sections, setSections] = useState([]);
  const [numPages, setNumPages] = useState(0);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [readingPath, setReadingPath] = useState([]);
  const [highlightedSections, setHighlightedSections] = useState([]);
  const [explanation, setExplanation] = useState(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [pathLoading, setPathLoading] = useState(false);
  const [error, setError] = useState(null);

  // Handle PDF file upload
  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Show PDF immediately in the reader
    const url = URL.createObjectURL(file);
    setPdfUrl(url);

    // Parse sections in the background
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${BACKEND}/api/parse`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setSections(data.sections || []);
    } catch (err) {
      setError('Could not parse PDF structure. Basic reading mode active.');
    }
  }, []);

  // Handle goal submission — generate reading path
  const handleGoalSubmit = useCallback(async (goal) => {
    setShowGoalModal(false);
    setPathLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BACKEND}/api/generate-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, sections }),
      });
      const data = await res.json();
      setReadingPath(data.path || []);
      setHighlightedSections(data.path.map(step => step.section));
    } catch (err) {
      setError('Could not generate reading path. Please try again.');
    } finally {
      setPathLoading(false);
    }
  }, [sections]);

  // Handle text selection — show explain button
  const handleTextSelect = useCallback(async (selectedText, context, section) => {
    if (!selectedText || selectedText.trim().length < 5) return;

    setExplanationLoading(true);
    setExplanation(null);

    try {
      const res = await fetch(`${BACKEND}/api/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_text: selectedText, context, section }),
      });
      const data = await res.json();
      setExplanation(data.explanation);
    } catch (err) {
      setExplanation('Could not generate explanation. Please try again.');
    } finally {
      setExplanationLoading(false);
    }
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Arial, sans-serif' }}>

      {/* Left Sidebar */}
      <div style={{ width: '260px', background: '#f8f9fa', borderRight: '1px solid #ddd',
                    padding: '16px', overflowY: 'auto', flexShrink: 0 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: '#2E4B8F' }}>AURA</h2>

        {!pdfUrl && (
          <div>
            <p style={{ fontSize: '13px', color: '#666' }}>Upload a research paper to begin.</p>
            <input type="file" accept=".pdf" onChange={handleFileUpload}
                   style={{ fontSize: '13px' }} />
          </div>
        )}

        {pdfUrl && (
          <button
            onClick={() => setShowGoalModal(true)}
            style={{ width: '100%', padding: '10px', background: '#2E4B8F', color: 'white',
                     border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
                     marginBottom: '16px' }}>
            + Set reading goal
          </button>
        )}

        {pathLoading && (
          <p style={{ fontSize: '13px', color: '#666' }}>Generating your reading path...</p>
        )}

        {readingPath.length > 0 && (
          <ReadingPathPanel path={readingPath} />
        )}

        {error && (
          <p style={{ fontSize: '12px', color: '#c0392b', marginTop: '8px' }}>{error}</p>
        )}
      </div>

      {/* Main Reader Area */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#e9e9e9', position: 'relative' }}>
        {!pdfUrl && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                        height: '100%', color: '#999', fontSize: '16px' }}>
            Your paper will appear here
          </div>
        )}

        {pdfUrl && (
          <DocumentWrapper file={pdfUrl} onDocumentLoad={({ numPages }) => setNumPages(numPages)}>
            {Array.from({ length: numPages }, (_, i) => (
              <PageWrapper key={i} pageIndex={i}>
                {/* Text selection overlay — Phase 4 will add this */}
              </PageWrapper>
            ))}
          </DocumentWrapper>
        )}
      </div>

      {/* Right Panel — Explanation */}
      {(explanation || explanationLoading) && (
        <ExplanationPanel
          explanation={explanation}
          loading={explanationLoading}
          onClose={() => setExplanation(null)}
        />
      )}

      {/* Goal Modal */}
      {showGoalModal && (
        <GoalModal
          onSubmit={handleGoalSubmit}
          onCancel={() => setShowGoalModal(false)}
        />
      )}
    </div>
  );
}
```

### 3.3 Update ui/demo/src/index.js to use AuraApp

Replace the existing App import with:
```jsx
import AuraApp from './AuraApp';
// render <AuraApp /> instead of <App />
```

**Phase 3 is done when:** the app loads, a PDF can be uploaded, it renders in the reader, and "Set reading goal" button appears.

---

## Phase 4 — Frontend: Goal Modal Component

**Goal:** A clean modal that lets the user pick a preset goal or type a custom one.

### 4.1 Create ui/demo/src/components/GoalModal.jsx

```jsx
import React, { useState } from 'react';

const PRESETS = [
  { label: 'Skim and decide relevance', description: 'Fast triage — key claims and read/not read decision' },
  { label: 'Replicate or extract method', description: 'Conditions, step summary, and saved artifacts' },
  { label: 'Get the big idea', description: '1-minute overview and key terms' },
];

export default function GoalModal({ onSubmit, onCancel }) {
  const [selected, setSelected] = useState(null);
  const [custom, setCustom] = useState('');

  const handleGenerate = () => {
    const goal = custom.trim() || selected;
    if (!goal) return;
    onSubmit(goal);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: 'white', borderRadius: '12px', padding: '32px',
        width: '480px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
      }}>
        <h2 style={{ margin: '0 0 6px', fontSize: '20px', color: '#1a1a1a' }}>
          What are you reading for?
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#666' }}>
          Pick a goal to generate a guided reading path. You can edit it later.
        </p>

        {PRESETS.map(preset => (
          <div
            key={preset.label}
            onClick={() => setSelected(preset.label)}
            style={{
              padding: '12px 16px', border: '1px solid',
              borderColor: selected === preset.label ? '#2E4B8F' : '#ddd',
              borderRadius: '8px', marginBottom: '8px', cursor: 'pointer',
              background: selected === preset.label ? '#EEF3FB' : 'white',
            }}>
            <div style={{ fontWeight: '600', fontSize: '14px', color: '#1a1a1a' }}>
              {preset.label}
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
              {preset.description}
            </div>
          </div>
        ))}

        <input
          type="text"
          placeholder='Or type a custom goal, e.g. "find the dataset" or "understand the loss function"'
          value={custom}
          onChange={e => { setCustom(e.target.value); setSelected(null); }}
          style={{
            width: '100%', padding: '10px 12px', border: '1px solid #ddd',
            borderRadius: '8px', fontSize: '13px', marginTop: '8px',
            boxSizing: 'border-box'
          }}
        />

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={{ padding: '10px 20px', border: '1px solid #ddd', borderRadius: '6px',
                     background: 'white', cursor: 'pointer', fontSize: '14px' }}>
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!selected && !custom.trim()}
            style={{
              padding: '10px 24px', background: (selected || custom.trim()) ? '#2E4B8F' : '#aaa',
              color: 'white', border: 'none', borderRadius: '6px',
              cursor: (selected || custom.trim()) ? 'pointer' : 'not-allowed', fontSize: '14px'
            }}>
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Phase 4 is done when:** clicking "Set reading goal" opens the modal, presets highlight on click, custom text input works, Generate calls onSubmit, Cancel closes without side effects.

---

## Phase 5 — Frontend: Reading Path Panel

**Goal:** Display the generated reading path in the sidebar with rationale labels. Highlight the relevant sections.

### 5.1 Create ui/demo/src/components/ReadingPathPanel.jsx

```jsx
import React, { useState } from 'react';

export default function ReadingPathPanel({ path }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: '8px' }}>
        <span style={{ fontSize: '12px', fontWeight: '600', color: '#2E4B8F',
                       textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Reading Path
        </span>
        <button onClick={() => setDismissed(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
                   fontSize: '16px', color: '#999', lineHeight: 1 }}>
          ×
        </button>
      </div>

      {path.map((step, i) => (
        <div key={i} style={{
          padding: '10px 12px', borderRadius: '8px', marginBottom: '8px',
          background: 'white', border: '1px solid #e0e7f3',
          borderLeft: '3px solid #2E4B8F'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{
              background: '#2E4B8F', color: 'white', borderRadius: '50%',
              width: '20px', height: '20px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '11px', fontWeight: '700', flexShrink: 0
            }}>
              {step.step}
            </span>
            <span style={{ fontWeight: '600', fontSize: '13px', color: '#1a1a1a' }}>
              {step.section}
            </span>
            <span style={{ fontSize: '11px', color: '#999', marginLeft: 'auto' }}>
              {step.page_ref}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: '#555', lineHeight: '1.4',
                      paddingLeft: '28px' }}>
            {step.rationale}
          </p>
        </div>
      ))}

      <button
        onClick={() => setDismissed(true)}
        style={{ width: '100%', padding: '8px', background: 'none', border: '1px solid #ddd',
                 borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: '#666',
                 marginTop: '4px' }}>
        Disable guidance
      </button>
    </div>
  );
}
```

### 5.2 Add section highlighting to the reader

In `AuraApp.jsx`, the `highlightedSections` state already tracks which sections are in the path. Use this to style sidebar section links — highlighted sections get a blue left border and slightly tinted background.

When PaperCraft's `DocumentWrapper` renders, use its outline/TOC capabilities to add visual indicators next to the highlighted section titles.

**Phase 5 is done when:** after generating a path, the sidebar shows numbered steps with rationale text, and a "Disable guidance" button clears the path.

---

## Phase 6 — Frontend: Inline Explanation Panel

**Goal:** User selects text, an "Explain this" button appears, clicking it opens a side panel with the AI explanation.

### 6.1 Add text selection detection to AuraApp.jsx

Add a `useEffect` that listens to the `mouseup` event on the document body:

```jsx
useEffect(() => {
  const handleMouseUp = () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText && selectedText.length >= 10) {
      // Get surrounding context: the paragraph containing the selection
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const paragraph = container.nodeType === 3
        ? container.parentElement?.closest('p, div, span')
        : container;
      const context = paragraph?.textContent || '';

      setSelectedTextData({ text: selectedText, context, section: '' });
      setShowExplainButton(true);
    } else {
      setShowExplainButton(false);
      setSelectedTextData(null);
    }
  };

  document.addEventListener('mouseup', handleMouseUp);
  return () => document.removeEventListener('mouseup', handleMouseUp);
}, []);
```

Add a floating "Explain this" button that appears near the selection:

```jsx
{showExplainButton && selectedTextData && (
  <div style={{
    position: 'fixed', bottom: '80px', right: explanation ? '340px' : '20px',
    zIndex: 999
  }}>
    <button
      onClick={() => {
        setShowExplainButton(false);
        handleTextSelect(
          selectedTextData.text,
          selectedTextData.context,
          selectedTextData.section
        );
      }}
      style={{
        padding: '8px 16px', background: '#2E4B8F', color: 'white',
        border: 'none', borderRadius: '20px', cursor: 'pointer',
        fontSize: '13px', boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
      }}>
      Explain this
    </button>
  </div>
)}
```

### 6.2 Create ui/demo/src/components/ExplanationPanel.jsx

```jsx
import React from 'react';

export default function ExplanationPanel({ explanation, loading, onClose }) {
  return (
    <div style={{
      width: '320px', background: 'white', borderLeft: '1px solid #ddd',
      padding: '20px', overflowY: 'auto', flexShrink: 0,
      display: 'flex', flexDirection: 'column', gap: '12px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: '700', color: '#2E4B8F',
                       textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Explanation
        </span>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
                   fontSize: '18px', color: '#999', lineHeight: 1 }}>
          ×
        </button>
      </div>

      <div style={{
        padding: '12px', background: '#F0F4FB', borderRadius: '8px',
        fontSize: '13px', color: '#1a1a1a', lineHeight: '1.6',
        minHeight: '60px'
      }}>
        {loading ? (
          <span style={{ color: '#666' }}>Generating explanation...</span>
        ) : (
          explanation
        )}
      </div>

      <div style={{ fontSize: '11px', color: '#999', borderTop: '1px solid #eee',
                    paddingTop: '8px' }}>
        AI-generated explanation. Always verify against the original text.
      </div>
    </div>
  );
}
```

**Phase 6 is done when:** selecting text in the PDF shows the "Explain this" button, clicking it shows a loading state then a plain-language explanation in the right panel, and the close button dismisses the panel cleanly.

---

## Phase 7 — Integration Testing

**Goal:** End-to-end flow works without errors for at least two real papers.

### 7.1 Test with a real paper

Use two papers from different formats:
- One ACM two-column paper (e.g. from dl.acm.org)
- One arXiv single-column paper

For each paper, run through the full flow:

1. Upload PDF → verify it renders
2. Click "Set reading goal" → modal opens
3. Select "Replicate or extract method" → click Generate
4. Verify path appears in sidebar with 3–5 steps and rationale text
5. Select a sentence in the Methods section → click "Explain this"
6. Verify explanation panel opens with non-empty text
7. Click × on explanation panel → panel closes
8. Click "Disable guidance" → path clears

### 7.2 Test error states

- Upload a non-PDF file → should show an error, not crash
- Disconnect from internet mid-session → LLM call should show "Could not generate" message
- Select very short text (2 words) → "Explain this" button should not appear

### 7.3 Fix any issues found

Common issues to watch for:
- CORS errors between frontend (port 3000) and backend (port 5001) — fix in `app.py` with `flask-cors`
- PaperMage returning empty sections for some PDFs — confirm fallback parser activates
- GPT returning malformed JSON — confirm `json.loads` fallback in `llm.py` handles it

**Phase 7 is done when:** the full flow works cleanly for both test papers with no console errors.

---

## Phase 8 — Polish and Demo Prep

**Goal:** The interface is clean enough to demonstrate to an audience.

### 8.1 UI polish checklist

- [ ] Loading states are visible for both path generation and explanation
- [ ] Error messages are shown in the UI, not just the console
- [ ] The "Disable guidance" button actually clears the path and highlights
- [ ] Explanation panel does not overlap the sidebar on narrow screens
- [ ] The PDF renders at a readable size by default (zoom ~100%)
- [ ] Uploading a second PDF resets all state (path, explanation, sections)

### 8.2 Prepare a demo paper

Choose one paper your team knows well — ideally a paper you read during the needfinding phase. Test the demo flow with this specific paper and verify the generated reading paths are sensible.

### 8.3 Prepare a demo script

Have a short script ready:
1. Open AURA with no PDF loaded
2. Upload the demo paper
3. Click "Set reading goal" — select "Replicate or extract method"
4. Show the generated path and explain one rationale label
5. Scroll to the Methods section
6. Select a dense sentence — click "Explain this"
7. Show the explanation panel
8. Click "Disable guidance" to show the reversibility

---

## Quick Reference: Running the Project

```bash
# Terminal 1 — Backend
cd backend
source venv/bin/activate
python app.py
# Runs on http://localhost:5001

# Terminal 2 — Frontend
cd ui
npm run start
# Runs on http://localhost:3000
```

---

## Known Limitations and Future Work

- **Citation Compare** (side-by-side citation verification) is deferred to a future phase. It requires Semantic Scholar API integration and Specter2 section alignment.
- **Editable reading path** (drag to reorder, add checkpoints) is deferred due to UI complexity.
- **Critical checkpoints** with claim-evidence links require precise PaperMage coordinate mapping and are deferred.
- PaperMage accuracy is approximately 90% on standard CS papers. Two-column IEEE and ACM formats may fall back to the heading-based parser.
- PDFs are processed by the OpenAI API. Unpublished drafts should not be uploaded without user consent.