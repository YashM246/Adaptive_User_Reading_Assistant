# Aura — How to Run

Aura has two parts: a **React frontend** (Vite + TypeScript) and a **Flask backend** (Python). The frontend runs PDF text extraction and a **local** reading-path heuristic in the browser; the backend adds **parse** (structured document storage), **LLM reading path**, **Explain this**, and **Ask about this paper** (`/api/query`).

---

## Prerequisites

- **Node.js** >= 18
- **Python** >= 3.10
- **npm** (comes with Node.js)
- A **Groq API key** (for LLM features via `openai/gpt-oss-120b`)

Optional (for full parsing / embeddings):

- **conda** (recommended for PaperMage and its native dependencies)
- **poppler** (required by PaperMage on macOS: `conda install poppler` or `brew install poppler`)

---

## 1. Clone and install frontend dependencies

```bash
cd aura
npm install
```

---

## 2. Set up the Python backend

### Create a virtual environment

```bash
cd aura/backend
python3 -m venv .venv
source .venv/bin/activate   # macOS / Linux
# .venv\Scripts\activate    # Windows
```

### Install Python dependencies

```bash
pip install -r requirements.txt
```

> **Note:** `papermage`, `torch`, and `sentence-transformers` are large packages. If you only need the core Flask + Groq features, you can install a lighter subset:
>
> ```bash
> pip install flask flask-cors groq python-dotenv
> ```
>
> The backend will fall back gracefully when PaperMage or Specter2 are not installed.

---

## 3. Configure environment variables

Edit `aura/.env` and set your Groq API key:

```
GROQ_API_KEY=gsk_your-actual-key-here
FLASK_PORT=5000
FLASK_DEBUG=true
```

The `.env` file lives in the `aura/` root directory (one level above `backend/`).

---

## 4. Start the backend

From the **`aura/`** directory (not `aura/backend/`):

```bash
source backend/.venv/bin/activate
python -m backend.app
```

You should see:

```
 * Running on http://127.0.0.1:5000
```

Verify it works:

```bash
curl http://127.0.0.1:5000/api/health
# {"status":"ok"}
```

---

## 5. Start the frontend

In a **separate terminal**, from the `aura/` directory:

```bash
npm run dev
```

Vite will start on `http://localhost:5173` (or the next available port). The Vite dev server automatically proxies all `/api/*` requests to the Flask backend on port 5000.

Open your browser to the URL Vite prints.

---

## 6. Using Aura

### Layout

- **Left panel** — Brand, reading goal chips (including **Custom…** with a text field), ordered path steps (drag to reorder), AI Assist toggle.
- **Center column** — Toolbar (filename, zoom, Open PDF), scrollable PDF viewer with goal highlights and text selection.
- **Right panel** (sticky) — **Explanation** (select text → **Explain this** → quote + Markdown explanation + “Where is this defined?”), and **Ask about this paper** at the bottom (separate from Explain; uses `/api/query`).

### Workflow

1. **Open a PDF** — Use **Open PDF** in the toolbar.
2. **Pick a reading goal** — Choose a preset or **Custom…**. For custom goals, type what you care about (e.g. “fairness and evaluation”); your words become extra keywords for ranking. The path updates as you type. **Press Enter** or finish editing the field to apply; the server reading path (if connected) uses the same text as `custom_goal`.
3. **Follow the path** — Click a step to jump; highlights are guidance only.
4. **Explain this** — Select text in the PDF, click the floating button. The upper part of the right panel loads an explanation only for that selection (unchanged behavior).
5. **Ask the paper** — Use the **Ask about this paper** box at the **bottom** of the right panel for questions; answers are based on retrieved paragraphs from the parsed document.
6. **Zoom** — Minus / plus in the toolbar; zoom uses CSS `zoom` so the page stays centered.

### Running without the backend

Without Flask, the app still:

- Renders PDFs with **pdfjs-dist**
- Builds a **local** reading path from sections/chunks and keywords (including **Custom** keywords from your text)

You will **not** get:

- `/api/parse` storage, `/api/explain`, `/api/query`, or LLM **reading-path** refresh

A yellow banner may appear when parse fails or the backend is down.

---

## Production build

### Frontend

```bash
npm run build
```

Output goes to `aura/dist/`. Serve with any static file server, or use:

```bash
npm run preview
```

### Backend

```bash
cd aura
gunicorn -w 2 -b 0.0.0.0:5000 "backend.app:create_app()"
```

---

## Project structure

```
aura/
├── .env
├── package.json
├── vite.config.ts           # /api proxy → Flask
├── README.md                # Overview, tech stack, feature summary
├── src/
│   ├── App.tsx
│   ├── App.css
│   ├── components/
│   │   ├── PageView.tsx
│   │   ├── PdfDocumentView.tsx
│   │   ├── ReadingPathPanel.tsx
│   │   └── ExplanationPanel.tsx   # Explain + Ask about paper
│   ├── lib/
│   │   ├── api/client.ts
│   │   ├── pdf/setup.ts
│   │   ├── retrieval/goalRetrieval.ts
│   │   └── structure/
│   └── types/aura.ts
└── backend/
    ├── app.py
    ├── routes/ parse, reading_path, explain, query (+ optional legacy routes)
    └── services/
```

See `README.md` for the full technology list and feature description.

---

## API endpoints (main UI)

| Endpoint             | Method | Description |
| -------------------- | ------ | ----------- |
| `/api/health`        | GET    | Health check |
| `/api/parse`         | POST   | Upload PDF → `doc_id` + structured text for retrieval |
| `/api/reading-path`  | POST   | LLM ordered path; body includes `goal` and optional `custom_goal` |
| `/api/explain`       | POST   | Explanation for a selected passage + context |
| `/api/query`         | POST   | Free-form question; backend retrieves relevant paragraphs |

Additional routes (`checkpoints`, `compare`, `citation`) may exist for other tooling; the streamlined Aura UI focuses on the table above.

---

## Design tokens

The UI uses a warm, light visual language (accent green, soft neutrals, serif brand type):

| Token            | Value     | Usage                                           |
| ---------------- | --------- | ----------------------------------------------- |
| `--accent`       | `#1B6B5A` | Primary green (buttons, active states, links)   |
| `--accent-soft`  | `#E4F4F0` | Light green tint (active chips, active step bg) |
| `--bg-canvas`    | `#FAFAF7` | Page background                                 |
| `--bg-muted`     | `#F2F1EC` | Secondary backgrounds (toolbar, cards)          |
| `--bg-panel`     | `#FFFFFF` | Panel backgrounds                               |
| `--bg-rail`      | `#121512` | Dark icon rail                                  |
| `--border`       | `#E3E3DE` | All borders                                     |
| `--highlight`    | `#F5E6C8` | PDF highlight color (warm amber)                |
| `--text-muted`   | `#8A9189` | Secondary text, labels                          |
| `--text-primary` | `#0F1210` | Primary text                                    |

Typography uses **Inter** for body/UI and **Cormorant Garamond** for brand/headings.

---

## Troubleshooting

**"Backend unavailable" banner appears**
- Make sure the Flask server is running on port 5000.
- Check the terminal running Flask for errors.
- Verify with `curl http://127.0.0.1:5000/api/health`.

**PaperMage import errors**
- PaperMage requires `poppler` system library. Install via `conda install poppler` or `brew install poppler`.
- If you cannot install PaperMage, the backend still works — it falls back to a simpler text extractor.

**Groq API errors**
- Verify your `GROQ_API_KEY` in `.env` is valid and has credit.
- The backend uses the `openai/gpt-oss-120b` model via Groq. Check [Groq's status page](https://status.groq.com) if requests fail.
- The backend returns a 502 status for LLM failures; the frontend shows a retry button.

**Large PDF takes a long time**
- PaperMage can be slow on large documents. The frontend shows "Processing PDF…" during this time.
- Parsed documents are cached in memory, so reloading the same PDF is instant.

**Fonts not loading**
- The app loads Inter and Cormorant Garamond from Google Fonts. If you're offline, the system font fallback (`system-ui`) will be used instead.
