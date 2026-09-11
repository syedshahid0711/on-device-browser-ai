from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from datetime import datetime
from app.utils.logger import get_logger

log = get_logger("inspector")
router = APIRouter(prefix="/api/inspector", tags=["Inspector"])

# In-memory storage for latest inspected profile and form fill details
latest_inspector_data = {
    "profile": {},
    "fill_details": [],
    "timestamp": None
}

class InspectorSyncRequest(BaseModel):
    profile: Optional[Dict[str, Any]] = None
    fill_details: Optional[List[Dict[str, Any]]] = None

@router.post("/sync")
async def sync_inspector_data(req: InspectorSyncRequest):
    """
    Receives live form fill details and profile data from the web dashboard or extension.
    """
    global latest_inspector_data
    profile = req.profile or {}
    fill_details = req.fill_details or []

    # If profile is empty but fill_details has items, reconstruct profile
    if not profile and fill_details:
        for item in fill_details:
            k = item.get("key")
            v = item.get("value")
            if k and v:
                profile[k] = v

    now_str = datetime.now().strftime("%H:%M:%S")
    latest_inspector_data = {
        "profile": profile,
        "fill_details": fill_details,
        "timestamp": now_str
    }
    log.info(f"📊 Data Inspector synced: {len(profile)} fields, {len(fill_details)} fill details at {now_str}")
    return {
        "success": True,
        "fields_count": len(profile),
        "fill_details_count": len(fill_details),
        "timestamp": now_str
    }

@router.get("/data")
async def get_inspector_data():
    """
    Returns the latest form fill and profile data for the Data Inspector views.
    """
    return {
        "success": True,
        "profile": latest_inspector_data.get("profile", {}),
        "fill_details": latest_inspector_data.get("fill_details", []),
        "timestamp": latest_inspector_data.get("timestamp")
    }

@router.post("/clear")
async def clear_inspector_data():
    """
    Wipes the inspector in-memory cache.
    """
    global latest_inspector_data
    latest_inspector_data = {
        "profile": {},
        "fill_details": [],
        "timestamp": None
    }
    return {"success": True, "message": "Inspector data cleared"}
