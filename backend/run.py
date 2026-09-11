"""
backend/run.py
Convenience script to start the Uvicorn server.
Usage: python run.py
"""

import uvicorn
import os
from dotenv import load_dotenv

load_dotenv()

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host    = os.getenv("HOST", "0.0.0.0"),
        port    = int(os.getenv("PORT", 8000)),
        reload  = True,
        reload_dirs = ["app"],
        log_level = "info",
    )
