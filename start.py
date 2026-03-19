"""
Railway startup script: run Alembic migrations then start uvicorn.
Replaces shell-based Procfile logic for better error visibility.
"""
import os
import subprocess
import sys


def run(cmd: list[str]) -> int:
    print(f">>> {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd)
    return result.returncode


# 1. Run migrations
rc = run(["alembic", "upgrade", "head"])
if rc != 0:
    print(f"WARNING: alembic upgrade head exited with code {rc}", flush=True)
    print("Continuing to start server...", flush=True)

# 2. Start uvicorn
port = os.environ.get("PORT", "8000")
sys.exit(run([
    "uvicorn", "backend.main:app",
    "--host", "0.0.0.0",
    "--port", port,
]))
