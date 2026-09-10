# 🛡️ Privacy Browser Agent — SIH26171

**On-Device Visual Perception for Lightweight Browser Agents**
*Smart India Hackathon 2024*

---

## What It Does

A privacy-preserving AI browser agent that fills web forms on your behalf while keeping all private data on your device.

**Key privacy guarantee:** Your actual name, email, phone, password, etc. **never leave your computer.** The server only sees the sanitized form structure (e.g., `"Name: [REDACTED_NAME]"`), not the real values.

```
User instruction
      ↓
Chrome Extension (DOM scan + PII detection)
      ↓
Sanitized context → Backend (Ollama LLM)
      ↓
Structured actions ← Backend
      ↓
Extension fills fields from LOCAL profile
      ↓
Form submitted ✓
```

---

## Quick Start

### Prerequisites
- Python 3.11+
- Google Chrome
- [Ollama](https://ollama.ai) installed and running
- `python-docx` and `python-multipart` (included in requirements.txt)

### 1. Start Ollama
```powershell
# Install Ollama from https://ollama.ai
ollama pull llama3.2          # ~2GB download, one-time
ollama serve                  # starts on localhost:11434
```

### 2. Start the Backend
```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env        # edit if needed
python run.py
# → Backend running at http://localhost:8000
# → API docs at http://localhost:8000/docs
```

### 3. Serve the Demo Website
```powershell
cd demo-website
python -m http.server 5500
# → Open http://localhost:5500 in Chrome
```

### 4. Load the Chrome Extension
1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The 🛡️ icon appears in your toolbar

### 5. Run the Demo
1. Open `http://localhost:5500` in Chrome
2. Click the 🛡️ extension icon
3. Go to **👤 Profile** tab → fill in your details manually OR click **Import from Word (.docx)** to automatically extract your resume/profile via local AI → **Save Profile Locally**
4. Go to **🤖 Agent** tab → click **Scan Page**
5. Type: `Fill my registration form and submit it`
6. Click **Start Agent**
7. Watch the form fill itself — private data never sent to server!

---

## Architecture

```
extension/
├── manifest.json              MV3 extension manifest
├── popup/                     Extension popup UI (4 tabs)
├── content/                   DOM analysis, action execution
├── background/                Service worker, backend comms
├── privacy/pii-detector.js    Local PII detection engine
├── automation/action-executor.js  Safe action runner
└── storage/profile-store.js   Local profile (chrome.storage.local)

backend/
├── app/main.py                FastAPI entry point
├── app/routes/analyze.py      POST /api/analyze (core endpoint)
├── app/routes/extract.py      POST /api/extract/profile (Word doc import)
├── app/routes/health.py       GET /api/health
├── app/routes/task.py         POST /api/task (history)
├── app/services/llm_service.py    Ollama integration
└── app/services/action_validator.py  Safety validation layer

demo-website/                  Realistic student registration form
docs/                          Architecture + API docs
```

---

## Privacy Model

| Data | Where It Stays |
|---|---|
| Name, Email, Phone, Password, DOB, Address | ✅ Chrome local storage only |
| Word Document Resumes/Profiles | ✅ Temporarily sent to local backend for AI extraction, then immediately discarded |
| Form structure (labels, field types) | ✅ Sent to backend (sanitized) |
| Actual PII values | ❌ NEVER sent to backend |
| AI action plan | ✅ Received from backend (no PII) |
| Task history | ✅ SQLite (counts only, no values) |

---

## Supported Actions

The AI can only request these 7 safe actions:

| Action | Description |
|---|---|
| `fill` | Fill a field from local profile (value never sent to server) |
| `click` | Click a button or link |
| `select` | Choose a dropdown option |
| `check` | Check a checkbox |
| `uncheck` | Uncheck a checkbox |
| `scroll` | Scroll the page |
| `navigate` | Navigate to a URL (http/https only) |

Arbitrary JavaScript execution is **blocked**.

---

## Tech Stack

- **Chrome Extension**: Manifest V3, Vanilla JS
- **Local LLM**: Ollama (llama3.2 / mistral / qwen2.5)
- **Backend**: Python + FastAPI + httpx
- **Local Storage**: `chrome.storage.local`
- **Task DB**: SQLite via aiosqlite

---

## Team / SIH Problem

**Problem Statement**: SIH26171  
**Theme**: On-Device Visual Perception for Lightweight Browser Agents
