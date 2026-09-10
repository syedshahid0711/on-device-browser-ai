"""
backend/app/routes/task.py
POST /api/task — store non-sensitive task history in SQLite
"""

from __future__ import annotations
from fastapi import APIRouter, HTTPException
from app.models.schemas import TaskRecord
from app.utils.logger import get_logger
import aiosqlite
import time
import os

router = APIRouter()
log    = get_logger("task")

DB_PATH = os.getenv("DB_PATH", "data/tasks.db")


async def get_db() -> aiosqlite.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS task_history (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            task         TEXT NOT NULL,
            page_type    TEXT,
            page_title   TEXT,
            actions_cnt  INTEGER,
            pii_detected INTEGER,
            duration_ms  INTEGER,
            success      INTEGER,
            created_at   INTEGER
        )
    """)
    await db.commit()
    return db


@router.post("/task", status_code=201)
async def create_task(record: TaskRecord):
    """Store a non-sensitive task completion record."""
    try:
        db = await get_db()
        await db.execute(
            """INSERT INTO task_history
               (task, page_type, page_title, actions_cnt, pii_detected, duration_ms, success, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.task[:200],     # truncate long tasks
                record.page_type,
                record.page_title[:100],
                record.actions_count,
                record.pii_detected,
                record.duration_ms,
                1 if record.success else 0,
                int(time.time()),
            )
        )
        await db.commit()
        await db.close()
        log.info("Task recorded: %r", record.task[:60])
        return {"ok": True}
    except Exception as e:
        log.error("Failed to store task: %s", e)
        raise HTTPException(status_code=500, detail="Failed to store task record")


@router.get("/task/history")
async def get_history(limit: int = 20):
    """Return recent task history (non-sensitive)."""
    try:
        db = await get_db()
        cursor = await db.execute(
            "SELECT * FROM task_history ORDER BY created_at DESC LIMIT ?", (limit,)
        )
        rows = await cursor.fetchall()
        await db.close()
        cols = ["id","task","page_type","page_title","actions_cnt","pii_detected","duration_ms","success","created_at"]
        return [dict(zip(cols, row)) for row in rows]
    except Exception as e:
        log.error("Failed to fetch history: %s", e)
        raise HTTPException(status_code=500, detail="Failed to retrieve history")
