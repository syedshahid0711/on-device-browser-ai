# Setup Guide

## System Requirements

| Requirement | Version |
|---|---|
| Windows | 10 / 11 |
| Python | 3.11+ |
| Chrome | 115+ (for MV3) |
| Ollama | Latest |
| RAM | 8 GB+ (16 GB recommended for llama3.2) |
| Disk | 4 GB free (for model weights) |

---

## Step 1 — Install Ollama

1. Download from **https://ollama.ai**
2. Run the installer
3. Open a terminal:

```powershell
ollama pull llama3.2        # 2.0 GB — recommended
# OR lighter alternatives:
ollama pull qwen2.5:3b      # 1.9 GB — faster, slightly less accurate
ollama pull mistral         # 4.1 GB — higher quality
```

4. Start the Ollama server:

```powershell
ollama serve
# Runs at http://localhost:11434
```

Verify: `curl http://localhost:11434/api/tags`

---

## Step 2 — Set Up the Backend

```powershell
cd "d:\sih project\backend"

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
copy .env.example .env
# (Edit .env if you want a different model or port)

# Start the server
python run.py
```

The backend will start at **http://localhost:8000**
- API docs: http://localhost:8000/docs
- Health check: http://localhost:8000/api/health

Expected output:
```
[INFO] Privacy Browser Agent Backend — Starting
[INFO] Ollama URL:   http://localhost:11434
[INFO] Ollama model: llama3.2
INFO:     Uvicorn running on http://0.0.0.0:8000
```

---

## Step 3 — Serve the Demo Website

Open a **second** terminal:

```powershell
cd "d:\sih project\demo-website"
python -m http.server 5500
```

Open Chrome → `http://localhost:5500`

You should see the Student Registration form.

---

## Step 4 — Load the Chrome Extension

1. Open Chrome → navigate to `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Browse to `d:\sih project\extension` → click **Select Folder**
5. The **🛡️ Privacy Agent** icon appears in the Chrome toolbar

> If you don't see the icon, click the Extensions puzzle-piece icon → pin Privacy Agent.

---

## Step 5 — Configure the Extension

1. Click the 🛡️ icon
2. Go to **⚙️ Settings** tab
3. Verify Backend URL is `http://localhost:8000`
4. Verify Ollama Model is `llama3.2` (or whatever you pulled)
5. Click **Save Settings**

---

## Step 6 — Set Up Your Profile

1. Click the 🛡️ icon
2. Go to **👤 Profile** tab
3. Fill in your details (this stays on your device):
   - Full Name, Email, Phone, DOB, Address
   - Student ID, Department, Gender, Year, Password
4. Click **💾 Save Profile Locally**

---

## Step 7 — Run the Demo

1. Open `http://localhost:5500` in Chrome
2. Click the 🛡️ extension icon
3. In the **🤖 Agent** tab, click **Scan Page**
   - You'll see: "PII Detected: 7", "Protected: 7"
4. Type in the task box:
   ```
   Fill my registration form and submit it
   ```
5. Click **Start Agent**

Watch the agent:
- Scan the page (DOM analysis)
- Send sanitized context to backend
- Receive action plan from Ollama
- Fill each field from your local profile
- Show confirmation dialog
- Submit the form

---

## Troubleshooting

### Extension shows "AI Server: Offline ✗"

- Check that `python run.py` is running in the backend folder
- Check that port 8000 is not in use: `netstat -an | findstr 8000`

### Backend shows "Cannot connect to Ollama"

- Run `ollama serve` in a separate terminal
- Verify: `curl http://localhost:11434/api/tags`

### Ollama returns invalid JSON

- Try a different model: edit `.env` → set `OLLAMA_MODEL=mistral`
- Increase timeout in `.env` if your machine is slow

### Extension doesn't fill fields

- Open Chrome DevTools on the demo website (F12)
- Check Console for `[PrivacyAgent]` messages
- Make sure your profile is saved (go to Profile tab)

### "No form found" error

- The demo website must be open in the active tab
- Try refreshing the page before running the agent
