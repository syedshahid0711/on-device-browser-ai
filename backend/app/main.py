"""
backend/app/main.py
FastAPI application entry point.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import health, analyze, task, extract
from app.utils.logger import get_logger
import os

log = get_logger("main")

app = FastAPI(
    title       = "Privacy Browser Agent — Backend",
    description = "SIH26171: On-device visual perception for lightweight browser agents.",
    version     = "1.0.0",
    docs_url    = "/docs",
    redoc_url   = "/redoc",
)

# ── CORS ─────────────────────────────────────────────────────────────────────
# Allow Chrome extension + demo website on localhost during development.
# Lock this down to specific origins in production.
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ALLOWED_ORIGINS,
    allow_credentials = False,
    allow_methods     = ["GET", "POST"],
    allow_headers     = ["Content-Type", "Accept"],
)

# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(health.router, prefix="/api", tags=["Health"])
app.include_router(analyze.router, prefix="/api", tags=["Agent"])
app.include_router(task.router,    prefix="/api", tags=["Tasks"])
app.include_router(extract.router)


@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": "Privacy Browser Agent Backend",
        "version": "1.0.0",
        "docs":    "/docs",
    }


@app.on_event("startup")
async def startup():
    log.info("=" * 60)
    log.info("Privacy Browser Agent Backend — Starting")
    log.info("Ollama URL:   %s", os.getenv("OLLAMA_URL", "http://localhost:11434"))
    log.info("Ollama model: %s", os.getenv("OLLAMA_MODEL", "llama3.2"))
    log.info("=" * 60)
