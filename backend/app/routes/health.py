"""
backend/app/routes/health.py
GET /api/health — liveness + Ollama status
"""

from fastapi import APIRouter
from app.models.schemas import HealthResponse
from app.services import llm_service
from app.utils.logger import get_logger
import os

router = APIRouter()
log    = get_logger("health")

@router.get("/health", response_model=HealthResponse)
async def health():
    ollama_ok = await llm_service.check_ollama()
    log.info("Health check — ollama_ok=%s", ollama_ok)
    return HealthResponse(
        status       = "ok",
        version      = "1.0.0",
        ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2"),
        ollama_ok    = ollama_ok,
    )
