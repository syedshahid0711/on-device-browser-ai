"""
backend/app/services/action_validator.py

Validates AI-generated actions against the allowed schema BEFORE
they are returned to the extension. This is a critical security layer.

Rules:
 - Action type must be in the allowed set
 - navigate URL must be http/https
 - No arbitrary JS or code strings
 - Required fields for each action type must be present
"""

from __future__ import annotations
from typing import List, Tuple
from app.models.schemas import Action, ActionType
from app.utils.logger import get_logger

log = get_logger("action_validator")

ALLOWED_ACTIONS: set[str] = {"fill", "click", "select", "check", "uncheck", "scroll", "navigate"}

REQUIRED_FIELDS: dict[str, list[str]] = {
    "fill":     ["target_id"],
    "click":    ["target_id"],
    "select":   ["target_id"],
    "check":    ["target_id"],
    "uncheck":  ["target_id"],
    "scroll":   ["direction"],
    "navigate": ["url"],
}

DANGEROUS_PATTERNS = [
    "javascript:", "data:", "vbscript:", "eval(", "Function(",
    "<script", "document.cookie", "localStorage", "sessionStorage",
]


def _is_safe_string(value: str) -> bool:
    """Reject strings containing dangerous patterns."""
    low = value.lower()
    return not any(pat.lower() in low for pat in DANGEROUS_PATTERNS)


def validate_action(action: Action) -> Tuple[bool, str]:
    """
    Returns (is_valid, reason).
    reason is empty string if valid.
    """
    if action.action not in ALLOWED_ACTIONS:
        return False, f"Disallowed action type: '{action.action}'"

    required = REQUIRED_FIELDS.get(action.action, [])
    for field in required:
        val = getattr(action, field, None)
        if not val:
            return False, f"Action '{action.action}' missing required field: '{field}'"

    # navigate: must be http(s)
    if action.action == "navigate":
        url = action.url or ""
        if not url.startswith(("http://", "https://")):
            return False, f"navigate blocked — only http/https allowed, got: '{url}'"
        if not _is_safe_string(url):
            return False, f"navigate URL contains dangerous pattern: '{url}'"

    # Check all string fields for dangerous content
    for field in ("target_id", "value", "profile_key", "url"):
        val = getattr(action, field, None)
        if val and isinstance(val, str) and not _is_safe_string(val):
            return False, f"Dangerous content in field '{field}': '{val}'"

    # fill/select: must have either (value_source=local_profile + profile_key) or a static value
    if action.action in ("fill", "select"):
        if action.value_source == "local_profile" and not action.profile_key:
            return False, f"{action.action} with value_source=local_profile requires profile_key"
        if not action.value_source and action.value is None:
            return False, f"{action.action} requires either value_source+profile_key or a static value"

    return True, ""


def validate_plan(actions: list[Action]) -> Tuple[List[Action], List[dict]]:
    """
    Validate a full action plan.
    Returns (valid_actions, rejected_actions).
    rejected_actions is a list of { action, reason }.
    """
    valid = []
    rejected = []

    for action in actions:
        ok, reason = validate_action(action)
        if ok:
            valid.append(action)
        else:
            log.warning("Rejected action: %s — %s", action.model_dump(), reason)
            rejected.append({"action": action.model_dump(), "reason": reason})

    log.info("Validation: %d/%d actions passed", len(valid), len(actions))
    return valid, rejected
