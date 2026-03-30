# AURA - Adaptive User Reading Assistant

AURA is an intelligent reading assistant for academic research papers. It redesigns the static PDF reading experience by adapting to the user's reading goal and providing in-document AI assistance - without requiring the user to leave the document.

## The Problem

Current PDF readers (Adobe Acrobat, arXiv, Google Scholar) present every paper identically, regardless of why the user is reading. Users must manually decide what to read, what to skip, and how to interpret dense content. When they get stuck, they copy text into ChatGPT in a separate tab - breaking their reading flow entirely.

This problem is especially acute for **non-native English speaking graduate students and researchers**, who must simultaneously parse unfamiliar domain concepts and formal academic English register.

## What AURA Does

AURA adds two intelligent interactions on top of a working PDF reader:

**1. Goal-Adaptive Reading Path**
The user states their reading goal (e.g. "replicate this method", "skim for relevance", "get the big idea"). AURA generates a personalized reading path - a ranked, ordered list of the most relevant sections - with a rationale for each step. Relevant sections are highlighted in the document. The user reads at their own pace; the path is guidance, not a constraint.

**2. Inline AI Explanation Panel**
When the user selects any text in the document, an "Explain this" button appears. Clicking it opens a side panel with a plain-language explanation of the selected passage, grounded in the paper's own context. A "Where is this defined?" link navigates to the nearest prior definition of the selected term within the paper.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (forked from PaperCraft by Allen AI) |
| Backend | Python / Flask |
| PDF Parsing | PaperMage (GROBID-based) |
| LLM | OpenAI GPT-4.1 mini |
| API | OpenAI API |

## Project Structure

```
aura/
├── frontend/          # React app - forked from PaperCraft
│   ├── src/
│   │   ├── components/
│   │   │   ├── GoalModal.jsx          # Goal-setting modal
│   │   │   ├── ReadingPathPanel.jsx   # Path preview and step display
│   │   │   ├── ExplanationPanel.jsx   # Inline AI explanation side panel
│   │   │   └── AuraReader.jsx         # Main reader wrapper
│   │   ├── hooks/
│   │   │   ├── useGoalPath.js         # Goal + path generation logic
│   │   │   └── useExplanation.js      # Text selection + explanation logic
│   │   └── App.jsx
├── backend/           # Flask API server
│   ├── app.py                         # Main Flask app
│   ├── parse.py                       # PaperMage PDF parsing
│   ├── llm.py                         # GPT-4.1 mini calls
│   └── requirements.txt
└── README.md
```

## Setup

See `Execution_Plan.md` for the full step-by-step setup and implementation guide.

## Team

- Yash Malode (malode@usc.edu)
- Marina Lee (mhlee@usc.edu)
- Julia Chun (jlchun@usc.edu)
- Nilakshi Nagrale (nagrale@usc.edu)
- Husnain Qadri (hqadri@usc.edu)

CSCI 599: Intelligent User Interactions - University of Southern California