"""
Extended ingestion endpoints:
  POST /ingest/bball-monster   — upload Basketball Monster CSV
  POST /ingest/yahoo-league    — fetch Yahoo Fantasy league data
"""

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import AsyncSessionLocal, get_db
from ..ingestion.bball_monster import ingest_bball_monster_csv
from ..ingestion.yahoo import ingest_yahoo_league


async def _bg_player_directory() -> None:
    """Background task: populate team+position for all active NBA players via PlayerIndex.
    Runs after the Yahoo sync response is already sent, so no timeout risk."""
    from ..ingestion.projections import ingest_player_directory
    async with AsyncSessionLocal() as db:
        try:
            n = await ingest_player_directory(db)
            print(f"[bg] Player directory done: {n} players.")
        except Exception as exc:
            print(f"[bg] Player directory failed: {exc}")

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
async def ingest_yahoo(background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    """
    Fetch all Yahoo Fantasy teams, rosters, and season-average stats.
    Requires YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REFRESH_TOKEN,
    YAHOO_LEAGUE_ID to be set in the environment.

    After responding, fires a background task to populate team+position data for
    all active NBA players so any player can be found in Add Player lookups.
    """
    result = await ingest_yahoo_league(db)
    background_tasks.add_task(_bg_player_directory)
    return YahooIngestResponse(
        status="ok",
        teams_upserted=result["teams_upserted"],
        players_upserted=result["players_upserted"],
    )
