"""
Extended ingestion endpoints:
  POST /ingest/bball-monster   — upload Basketball Monster CSV
  POST /ingest/yahoo-league    — fetch Yahoo Fantasy league data
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..ingestion.bball_monster import ingest_bball_monster_csv
from ..ingestion.yahoo import ingest_yahoo_league

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
    file: UploadFile = File(..., description="Basketball Monster CSV export"),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a Basketball Monster CSV export to populate bball_monster projections.
    After ingesting, switch the active source with POST /projections/source.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    csv_bytes = await file.read()
    if not csv_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        result = await ingest_bball_monster_csv(db, csv_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return BballMonsterResponse(
        status="ok",
        upserted=result["upserted"],
        skipped=result["skipped"],
    )


@router.post("/yahoo-league", response_model=YahooIngestResponse)
async def ingest_yahoo(db: AsyncSession = Depends(get_db)):
    """
    Fetch all Yahoo Fantasy teams, rosters, and season-average stats.
    Requires YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REFRESH_TOKEN,
    YAHOO_LEAGUE_ID to be set in the environment.
    """
    result = await ingest_yahoo_league(db)
    return YahooIngestResponse(
        status="ok",
        teams_upserted=result["teams_upserted"],
        players_upserted=result["players_upserted"],
    )
