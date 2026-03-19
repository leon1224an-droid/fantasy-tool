"""
Extended ingestion endpoints:
  POST /ingest/bball-monster       — upload Basketball Monster CSV/Excel manually
  POST /ingest/bball-monster-auto  — auto-login to BBM and download projections
  POST /ingest/yahoo-league        — fetch Yahoo Fantasy league data
"""

import asyncio
import os

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth_utils import get_current_user
from ..database import get_db
from ..ingestion.bball_monster import ingest_bball_monster_bytes, ingest_bball_monster_csv
from ..ingestion.bball_monster_scraper import download_bball_monster_projections
from ..ingestion.yahoo import ingest_yahoo_league
from ..models import User

router = APIRouter(prefix="/ingest", tags=["ingestion"])


class BballMonsterResponse(BaseModel):
    status: str
    upserted: int
    skipped: int


class YahooIngestResponse(BaseModel):
    status: str
    teams_upserted: int
    players_upserted: int


@router.post("/bball-monster", response_model=BballMonsterResponse)
async def ingest_bball_monster(
    file: UploadFile = File(..., description="Basketball Monster CSV or Excel export"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Upload a Basketball Monster CSV or Excel export to populate bball_monster projections
    for the authenticated user's roster.
    """
    if not file.filename or not file.filename.lower().endswith((".csv", ".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="File must be a .csv or .xlsx")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        result = await ingest_bball_monster_bytes(db, file_bytes, user_id=current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return BballMonsterResponse(
        status="ok",
        upserted=result["upserted"],
        skipped=result["skipped"],
    )


@router.post("/bball-monster-auto", response_model=BballMonsterResponse)
async def ingest_bball_monster_auto(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Log into Basketball Monster automatically using BBM_EMAIL / BBM_PASSWORD env vars,
    download the projections Excel file, and ingest it — no manual upload needed.

    Optional env var BBM_DOWNLOAD_URL overrides the default download URL.
    See backend/ingestion/bball_monster_scraper.py for setup instructions.
    """
    email = os.getenv("BBM_EMAIL", "").strip()
    password = os.getenv("BBM_PASSWORD", "").strip()
    if not email or not password:
        raise HTTPException(
            status_code=400,
            detail="BBM_EMAIL and BBM_PASSWORD must be set in the server environment.",
        )

    try:
        excel_bytes = await asyncio.get_event_loop().run_in_executor(
            None, download_bball_monster_projections, email, password
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"BBM download failed: {exc}") from exc

    try:
        result = await ingest_bball_monster_bytes(db, excel_bytes, user_id=current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return BballMonsterResponse(status="ok", **result)


@router.post("/yahoo-league", response_model=YahooIngestResponse)
async def ingest_yahoo(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Fetch all Yahoo Fantasy teams, rosters, and season-average stats for the
    authenticated user's Yahoo league.

    Requires the user to have linked their Yahoo account via GET /auth/yahoo/link
    and to have set their league ID via PATCH /auth/me/yahoo.
    """
    if not current_user.yahoo_refresh_token:
        raise HTTPException(
            status_code=400,
            detail="Yahoo account not linked. Use GET /auth/yahoo/link to authorize first.",
        )
    if not current_user.yahoo_league_id:
        raise HTTPException(
            status_code=400,
            detail="Yahoo league ID not set. Use PATCH /auth/me/yahoo to set it.",
        )

    result = await ingest_yahoo_league(db, user=current_user)
    return YahooIngestResponse(
        status="ok",
        teams_upserted=result["teams_upserted"],
        players_upserted=result["players_upserted"],
    )
