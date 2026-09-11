"""
backend/app/services/vlm_agent.py

Vision-Language Model (VLM) integration for server-side AI reasoning.
Accepts a redacted screenshot and a user task, returning CSS-selector based actions.

Since Ollama (llama3.2) is a text model, we use the page_context fields
that the extension passes alongside the screenshot to reason about the next action.
The agent tracks already-filled fields via the `completed_selectors` list in the request
and returns {"status": "complete"} once all required fields are handled.
"""

from __future__ import annotations
import json
import os
import re
from typing import List, Optional

import httpx
from app.models.schemas import VLMAnalyzeRequest, VLMAnalyzeResponse, ActionType
from app.utils.logger import get_logger

log = get_logger("vlm_agent")

OLLAMA_URL   = os.getenv("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
TIMEOUT_SEC  = 120.0

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an AI browser automation agent.
You are given a list of form fields on the current webpage and a user task.
Your goal is to identify the SINGLE NEXT field to fill or action to perform.

CRITICAL RULES:
1. Reply ONLY with a valid JSON object. No markdown. No explanation outside the JSON.
2. The JSON must match this structure exactly:
{
  "status": "in_progress" | "complete" | "error",
  "reasoning": "Brief explanation of your decision.",
  "action": "fill" | "click" | "select" | "check" | "scroll",
  "target_css_selector": "input#field_id" or "input[name='x']" or "#submit_btn",
  "value": "the value to fill (only for fill/select actions)"
}
3. If all fillable fields have been handled (they appear in completed_selectors), return:
   {"status": "complete", "reasoning": "All fields have been filled."}
4. For sensitive fields (email, phone, name, password, dob, address), return:
   {"action": "fill", "target_css_selector": "...", "value": "__PROFILE__:<profile_key>"}
   where profile_key is one of: name, email, phone, dob, address, employee_id, gender, clearance, password
5. For select/dropdown fields use action "select" with the best matching value from the options list.
6. For checkboxes use action "check".
7. For the submit button use action "click" and set status "complete".
8. NEVER repeat a selector that already appears in completed_selectors.
9. Prefer CSS selectors using id (#field-id) when an id is available.

REPLY WITH JSON ONLY.
"""


def build_vlm_prompt(req: VLMAnalyzeRequest) -> str:
    fields_info = ""
    if req.page_fields:
        lines = []
        for f in req.page_fields:
            line = f"  - selector: #{f.get('id', '')} | name={f.get('name', '')} | label={f.get('label', '')} | type={f.get('type', '')} | sensitive={f.get('sensitive', False)} | required={f.get('required', False)}"
            if f.get("options"):
                opts = [o.get("label", o.get("value", "")) for o in f["options"][:6]]
                line += f" | options={opts}"
            lines.append(line)
        fields_info = "\n".join(lines)
    else:
        fields_info = "  (no structured field data available — use screenshot reasoning)"

    completed = "\n".join(f"  - {s}" for s in (req.completed_selectors or [])) or "  (none yet)"

    return f"""USER TASK: {req.task}

FORM FIELDS ON THIS PAGE:
{fields_info}

ALREADY COMPLETED SELECTORS (do NOT repeat these):
{completed}

PREVIOUS ERRORS (if any): {req.previous_errors or 'none'}

Determine the single next action to take. If all required fields are done, return status=complete.
"""


def extract_json(raw: str) -> dict:
    """Extract JSON from LLM output that may contain markdown fences or extra text."""
    raw = re.sub(r"```(?:json)?", "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]+\}", raw)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    raise ValueError(f"Could not extract JSON from LLM response:\n{raw[:500]}")


async def analyze_vision(req: VLMAnalyzeRequest) -> VLMAnalyzeResponse:
    """
    Real Ollama integration for VLM-based form automation.
    Uses page field context (passed alongside screenshot) to reason about the next action.
    """
    log.info("VLM Agent — task: %s | completed: %s | errors: %s",
             req.task[:60],
             req.completed_selectors or [],
             req.previous_errors or [])

    prompt = build_vlm_prompt(req)

    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": prompt},
        ],
        "options": {
            "temperature": 0.1,
            "num_predict": 512,
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
            "Please run: ollama serve"
        )
    except httpx.TimeoutException:
        raise RuntimeError(f"Ollama VLM request timed out after {TIMEOUT_SEC}s")
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Ollama HTTP error: {e.response.status_code} — {e.response.text[:200]}")

    raw_content = resp.json()["message"]["content"]
    log.debug("VLM raw response:\n%s", raw_content)

    try:
        data = extract_json(raw_content)
    except Exception as e:
        log.error("Failed to parse VLM JSON: %s\nRaw: %s", e, raw_content[:300])
        raise RuntimeError("VLM returned invalid JSON")

    status = data.get("status", "error")
    action = data.get("action")
    selector = data.get("target_css_selector")
    value = data.get("value")
    reasoning = data.get("reasoning", "")

    # Validate action type
    allowed_actions = {"fill", "click", "select", "check", "uncheck", "scroll"}
    if action and action not in allowed_actions:
        log.warning("VLM returned invalid action '%s' — defaulting to error", action)
        status = "error"
        reasoning = f"Invalid action: {action}"
        action = None

    log.info("VLM decision: status=%s action=%s selector=%s", status, action, selector)

    return VLMAnalyzeResponse(
        status=status,
        action=action,
        target_css_selector=selector,
        value=value,
        reasoning=reasoning,
        confidence=0.9,
        model_used=OLLAMA_MODEL,
    )
