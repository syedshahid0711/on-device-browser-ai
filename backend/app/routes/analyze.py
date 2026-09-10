"""
backend/app/routes/analyze.py
POST /api/analyze — core endpoint: receive sanitized page context → return action plan
"""

from fastapi import APIRouter, HTTPException
from app.models.schemas import AnalyzeRequest, AnalyzeResponse
from app.services import llm_service
from app.services.action_validator import validate_plan
from app.utils.logger import get_logger
import time

router = APIRouter()
log    = get_logger("analyze")


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    log.info("POST /analyze — task=%r, page=%r, fields=%d",
             req.task[:60], req.page_context.title[:40], len(req.page_context.fields))

    # Confirm no raw PII slipped through (defense in depth)
    for field in req.page_context.fields:
        if field.sensitive and field.value and not field.value.startswith("[REDACTED"):
            log.warning("Potential un-redacted sensitive field '%s' — forcing redact", field.id)
            field.value = f"[REDACTED_{(field.pii_category or 'PII').upper()}]"

    t0 = time.time()

    try:
        response = await llm_service.analyze(req)
    except RuntimeError as e:
        log.error("LLM error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        log.error("Unexpected error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error during AI analysis")

    elapsed_ms = round((time.time() - t0) * 1000)
    log.info("LLM responded in %dms — %d actions", elapsed_ms, len(response.actions))

    # Validate every action before returning
    valid_actions, rejected = validate_plan(response.actions)

    if rejected:
        log.warning("Rejected %d unsafe actions: %s", len(rejected), rejected)

    if not valid_actions:
        raise HTTPException(
            status_code=422,
            detail="AI returned no valid safe actions. Please try again or rephrase the task."
        )

    response.actions = valid_actions
    log.info("Returning %d validated actions", len(valid_actions))
    return response
