"""
backend/app/models/schemas.py
Pydantic models and request/response schemas for the Privacy Browser Agent backend.
"""

from __future__ import annotations
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ActionType(str, Enum):
    fill = "fill"
    click = "click"
    select = "select"
    check = "check"
    uncheck = "uncheck"
    scroll = "scroll"
    navigate = "navigate"


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "1.0.0"
    ollama_model: str = "llama3.2"
    ollama_ok: bool = False


class Action(BaseModel):
    action: str
    target_id: Optional[str] = None
    value_source: Optional[str] = None
    profile_key: Optional[str] = None
    value: Optional[Any] = None
    direction: Optional[str] = None
    url: Optional[str] = None


class FieldInfo(BaseModel):
    id: str
    name: Optional[str] = None
    label: Optional[str] = ""
    type: Optional[str] = "text"
    sensitive: Optional[bool] = False
    pii_category: Optional[str] = None
    value: Optional[str] = None
    required: Optional[bool] = False
    options: Optional[List[Dict[str, Any]]] = None


class PageContext(BaseModel):
    url: str
    title: Optional[str] = ""
    page_type: Optional[str] = "form"
    fields: List[FieldInfo] = Field(default_factory=list)
    summary: Optional[Dict[str, Any]] = Field(default_factory=dict)


class AnalyzeRequest(BaseModel):
    task: str
    page_context: PageContext


class AnalyzeResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    actions: List[Action] = Field(default_factory=list)
    reasoning: Optional[str] = ""
    confidence: Optional[float] = 1.0
    model_used: Optional[str] = "llama3.2"


class VLMAnalyzeRequest(BaseModel):
    task: str
    image_base64: Optional[str] = ""
    page_fields: Optional[List[Dict[str, Any]]] = None
    completed_selectors: Optional[List[str]] = None
    previous_errors: Optional[List[str]] = None


class VLMAnalyzeResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    status: str
    action: Optional[str] = None
    target_css_selector: Optional[str] = None
    value: Optional[str] = None
    reasoning: Optional[str] = ""
    confidence: Optional[float] = 0.9
    model_used: Optional[str] = "llama3.2"


class TaskRecord(BaseModel):
    task: str
    page_type: Optional[str] = "form"
    page_title: Optional[str] = ""
    actions_count: Optional[int] = 0
    pii_detected: Optional[int] = 0
    duration_ms: Optional[int] = 0
    success: Optional[bool] = True
