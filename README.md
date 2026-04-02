# Aura

**Aura** is a browser-based reading assistant for research PDFs. Choose *why* you are reading (skim, deep study, critique methods, extract contributions, replication, or a custom goal), follow an ordered path with on-page highlights, and use optional AI for explanations and document-grounded Q&amp;A.

---

## What it is

Aura is a **single-page web app** (React) with a **three-column layout**: reading goals and an editable step list on the left, the PDF in the center, and explanations plus questions on the right. The UI works **standalone**: PDF.js parses and renders the file in the browser, and a **local heuristic** can build a reading path from section structure even when the server is offline. With the **Python backend** running, Aura also uploads the PDF for structured parsing, refreshes the path using an LLM, and powers **Explain this** and **Ask about this paper** through a small REST API.

**Typical platforms:** macOS, Windows, or Linux with Node.js 18+ for the frontend; Python 3.10+ for the backend. Any **modern Chromium-, Firefox-, or Safari-class browser** is suitable for the reader.

---

## Features

| Area | What you get |
|------|----------------|
| **Goals & path** | Preset goals (skim, deep study, methods critique, big idea, replication) plus **Custom…** with free text. Steps show section titles and short *why read this* rationales; reorder by dragging. Highlights in the PDF reflect the path as **guidance**, not a lock-step mandate. |
| **Explain this** | Select text in the PDF, click the floating control, and see a **plain-language** explanation with optional confidence; answers render as **Markdown**. |
| **Ask about this paper** | Separate bottom panel for **document-wide questions** grounded in parsed paper text (`/api/query`, length-capped for the model). Independent from the selection flow so long answers can be dismissed without clearing your “Explain this” context. |
| **Reading comfort** | Toolbar **zoom** (CSS `zoom` so layout stays centered), scrollable reader column sized to the window, **AI Assist** toggle, and a clear banner when the backend is unreachable. |

---

## Libraries & stack

### Frontend (`package.json`)

| Package | Role |
|---------|------|
| [React](https://react.dev/) 19 | UI |
| [TypeScript](https://www.typescriptlang.org/) | Typing |
| [Vite](https://vitejs.dev/) 8 | Dev server, build, `/api` proxy |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | PDF render, text layer, geometry for highlights and selection |
| [react-markdown](https://github.com/remarkjs/react-markdown) | Markdown in explanation and Q&amp;A panels |

**Tooling:** ESLint, `typescript-eslint`, `@vitejs/plugin-react`.

### Backend (`backend/requirements.txt`)

| Package | Role |
|---------|------|
| [Flask](https://flask.palletsprojects.com/) | HTTP API |
| [flask-cors](https://flask-cors.readthedocs.io/) | CORS for the Vite dev origin |
| [Groq](https://groq.com/) (`groq` SDK) | LLM calls (default model in `backend/config.py`, e.g. `openai/gpt-oss-120b`) |
| [python-dotenv](https://github.com/theskumar/python-dotenv) | `.env` loading |
| [Gunicorn](https://gunicorn.org/) | Production WSGI server |

Optional / heavier: **PaperMage**, **PyTorch**, **sentence-transformers** for richer parsing and embeddings; the app **degrades gracefully** if they are not installed (simpler text extraction, no Specter2, etc.).

---

## Project layout (high level)

```
aura/
├── .env                 # GROQ_API_KEY, FLASK_* (at repo root of this app)
├── index.html
├── package.json
├── vite.config.ts       # Dev proxy /api → Flask
├── HOW_TO_RUN.md        # Install, env, run, troubleshooting
├── public/favicon.svg
├── src/                 # React app (App, panels, PDF views, API client)
└── backend/             # Flask app, routes (parse, explain, query, compare, citation), services
```

---

## Quick start

Full steps (virtualenv, `.env`, two terminals, production notes) are in **[HOW_TO_RUN.md](./HOW_TO_RUN.md)**.

```bash
cd aura
npm install
# Terminal 1 — from aura/
python -m backend.app
# Terminal 2
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

---

## npm scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | `tsc -b` + production bundle to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |

---

## License / course use

Built for academic and personal use (e.g. course projects). Add a `LICENSE` file if you redistribute publicly.
