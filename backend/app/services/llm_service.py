"""
backend/app/services/llm_service.py

Ollama integration for server-side AI reasoning.
Sends SANITIZED page context → Ollama local LLM → structured JSON actions.

Privacy guarantee: this service NEVER receives real user PII values.
The page context arriving here already has sensitive fields redacted
(e.g., "value": "[REDACTED_EMAIL]").

Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
Default endpoint: http://localhost:11434
"""

from __future__ import annotations
import json
import os
import re
from typing import List

import httpx
from app.models.schemas import Action, AnalyzeRequest, AnalyzeResponse
from app.utils.logger import get_logger

log = get_logger("llm_service")

OLLAMA_URL   = os.getenv("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
TIMEOUT_SEC  = 120.0


# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an AI browser agent assistant. Your job is to analyze a webpage's structure and produce a precise, safe, structured list of browser actions to complete a user's task.

CRITICAL RULES:
1. You receive a SANITIZED page description — sensitive fields have values like "[REDACTED_EMAIL]", "[REDACTED_NAME]", etc.
2. You MUST use "value_source": "local_profile" and "profile_key" for ANY field that maps to a profile key. NEVER invent real values.
3. For non-profile select fields, specify a static "value" matching the exact option value (not label).
4. Only use these action types: fill, click, select, check, uncheck, scroll, navigate.
5. Always match "target_id" to the EXACT field "id" shown in the page context.
6. If there is a terms/agreement checkbox, ALWAYS output a 'check' action for it.
7. If there are password AND confirm_password fields, output 'fill' actions for BOTH using profile_key "password".
8. Ignore file upload fields.
9. For fields like "Clearance Level", "Clearance" → use profile_key: "clearance".
10. For "Employee ID", "Emp ID" → use profile_key: "employee_id".
11. Return ONLY valid JSON — no markdown, no explanation outside the JSON.

PROFILE KEYS available for fill and select actions:
  name, email, phone, dob, address, employee_id, division, gender, clearance, password

RESPONSE FORMAT (strict JSON only):
{
  "reasoning": "Brief explanation of what you detected and why these actions",
  "confidence": 0.95,
  "actions": [
    {"action": "fill",   "target_id": "full_name",        "value_source": "local_profile", "profile_key": "name"},
    {"action": "fill",   "target_id": "employee_id",      "value_source": "local_profile", "profile_key": "employee_id"},
    {"action": "fill",   "target_id": "dob",              "value_source": "local_profile", "profile_key": "dob"},
    {"action": "select", "target_id": "gender",           "value_source": "local_profile", "profile_key": "gender"},
    {"action": "fill",   "target_id": "email",            "value_source": "local_profile", "profile_key": "email"},
    {"action": "fill",   "target_id": "phone",            "value_source": "local_profile", "profile_key": "phone"},
    {"action": "fill",   "target_id": "address",          "value_source": "local_profile", "profile_key": "address"},
    {"action": "select", "target_id": "division",         "value_source": "local_profile", "profile_key": "division"},
    {"action": "select", "target_id": "clearance_level",  "value_source": "local_profile", "profile_key": "clearance"},
    {"action": "fill",   "target_id": "password",         "value_source": "local_profile", "profile_key": "password"},
    {"action": "fill",   "target_id": "confirm_password", "value_source": "local_profile", "profile_key": "password"},
    {"action": "check",  "target_id": "terms"},
    {"action": "click",  "target_id": "submit-btn"}
  ]
}"""


# ── Build the user prompt ─────────────────────────────────────────────────────

def build_prompt(req: AnalyzeRequest) -> str:
    ctx = req.page_context

    # Build a clean field summary (no real PII — already sanitized by extension)
    field_lines = []
    for f in ctx.fields:
        line = f"  - id={f.id!r}, label={f.label!r}, type={f.type!r}, sensitive={f.sensitive}"
        if f.required:
            line += ", required=true"
        if f.options:
            opts = [o.get("label", o.get("value", "")) for o in f.options[:8]]
            line += f", options={opts}"
        if f.value and not f.sensitive:
            line += f", current_value={f.value!r}"
        field_lines.append(line)

    fields_str = "\n".join(field_lines)

    return f"""USER TASK: {req.task}

PAGE INFORMATION:
  URL: {ctx.url}
  Title: {ctx.title}
  Type: {ctx.page_type}
  Total fields: {ctx.summary.get("total", "?")}
  Sensitive fields: {ctx.summary.get("sensitive", "?")} (values redacted for privacy)

FORM FIELDS:
{fields_str}

Produce the JSON action plan to complete the user's task. Remember:
- For ALL fields that correspond to the available PROFILE KEYS (even non-sensitive select/dropdown fields like division or clearance), you MUST use "value_source": "local_profile" and the appropriate "profile_key". DO NOT specify a static "value" for them.
- ONLY for select/dropdown fields that DO NOT correspond to a profile key, use a static "value" matching the exact option label.
- End with a click action on the submit button if the task requires form submission.
"""


# ── Parse LLM response ────────────────────────────────────────────────────────

def extract_json(raw: str) -> dict:
    """
    Extract JSON from LLM output that may contain markdown code fences
    or extra text before/after the JSON object.
    """
    # Strip markdown code fences
    raw = re.sub(r"```(?:json)?", "", raw).strip()

    # Try direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Try finding the first {...} block
    match = re.search(r"\{[\s\S]+\}", raw)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not extract JSON from LLM response:\n{raw[:500]}")


def parse_actions(data: dict) -> List[Action]:
    actions = []
    for raw in data.get("actions", []):
        try:
            # Fix LLM profile_key hallucinations at the source
            if raw.get("profile_key") == "clearance_level":
                raw["profile_key"] = "clearance"
            if raw.get("profile_key") == "full_name":
                raw["profile_key"] = "name"
                
            action = Action(**raw)
            actions.append(action)
        except Exception as e:
            log.warning("Skipped malformed action %s: %s", raw, e)
    return actions


# ── Ollama health check ───────────────────────────────────────────────────────

async def check_ollama() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False


# ── Main inference call ───────────────────────────────────────────────────────

async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    """
    Send a sanitized analyze request to Ollama and return structured actions.
    """
    prompt = build_prompt(req)
    log.info("Calling Ollama model=%s for task: %r", OLLAMA_MODEL, req.task[:80])
    log.debug("Prompt:\n%s", prompt)

    payload = {
        "model":  OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system",  "content": SYSTEM_PROMPT},
            {"role": "user",    "content": prompt},
        ],
        "options": {
            "temperature": 0.1,    # low temp for deterministic structured output
            "num_predict": 1024,
            "num_ctx": 2048,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SEC) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
            resp.raise_for_status()
    except httpx.ConnectError:
        raise RuntimeError(
            f"Cannot connect to Ollama at {OLLAMA_URL}. "
            "Please start Ollama: run `ollama serve` in a terminal."
        )
    except httpx.TimeoutException:
        raise RuntimeError(f"Ollama request timed out after {TIMEOUT_SEC}s")
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Ollama HTTP error: {e.response.status_code} — {e.response.text[:200]}")

    raw_content = resp.json()["message"]["content"]
    log.debug("Raw LLM output:\n%s", raw_content)

    try:
        data    = extract_json(raw_content)
        actions = parse_actions(data)
    except Exception as e:
        log.error("Failed to parse LLM output: %s\nRaw: %s", e, raw_content[:300])
        raise RuntimeError(f"LLM returned invalid JSON: {e}")

    return AnalyzeResponse(
        actions    = actions,
        reasoning  = data.get("reasoning", ""),
        confidence = float(data.get("confidence", 1.0)),
        model_used = OLLAMA_MODEL,
    )

# ── Profile Extraction ────────────────────────────────────────────────────────

EXTRACT_SYSTEM_PROMPT = """You are an advanced AI data extraction engine with expertise in unstructured documents. Your task is to perform deep information extraction from the provided raw text (which may be a resume, ID document, table, or unstructured personal file).

Extract EVERY matching field you can find into a strict JSON object. Be highly intelligent about contextual clues, synonyms, tabular formats, and variations in wording.

Fields to extract:
- "name": Full name of the person.
- "email": Email address.
- "phone": Phone or mobile number.
- "dob": Date of birth (format as YYYY-MM-DD if possible).
- "address": Full physical or residential address.
- "employee_id": Employee ID, student ID, or staff number.
- "division": Department or division (e.g., aeronautics, propulsion, spacecraft, avionics, mission_control).
- "gender": male, female, non_binary, or prefer_not.
- "clearance": Security clearance level (e.g., level_1, level_2, secret, top_secret).
- "password": If present, extract the exact password, passcode, PIN, or secret key. Look for keywords like "Password:", "Pass:", "Pwd:", "PIN:", "Secret:", "Login Key:", or similar followed by a value. Include symbols or numbers exactly as written.

CRITICAL RULES:
1. If a field is not found (including password), simply omit it from the JSON. Do not use null or empty strings.
2. For "password", it might be isolated in a table row or paragraph. Always extract the literal string exactly as it appears. Ensure you check thoroughly.
3. ABSOLUTELY NO CONVERSATIONAL TEXT. Return ONLY a valid JSON object. Do not apologize or explain if fields are missing.
"""

async def extract_profile_from_text(text: str) -> dict:
    """
    Send raw text to Ollama to extract profile fields into JSON.
    """
    log.info("Extracting profile from text using model=%s", OLLAMA_MODEL)
    
    advanced_user_prompt = f"Extract profile data into strict JSON format from this text:\n\n[DOCUMENT START]\n{text}\n[DOCUMENT END]"
    
    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": EXTRACT_SYSTEM_PROMPT},
            {"role": "user", "content": advanced_user_prompt},
        ],
        "options": {
            "temperature": 0.1,
            "num_predict": 1024,
            "num_ctx": 4096,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SEC) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
            resp.raise_for_status()
    except Exception as e:
        log.error("Ollama extraction failed: %s", e)
        raise RuntimeError(f"Extraction failed: {e}")

    raw_content = resp.json()["message"]["content"]
    try:
        return extract_json(raw_content)
    except Exception as e:
        log.error("Failed to parse extracted JSON: %s\\nRaw: %s", e, raw_content[:300])
        raise RuntimeError("LLM returned invalid JSON for profile extraction")
