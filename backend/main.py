"""
FastAPI application entry point.

Endpoints
---------
GET  /health                  — liveness check
POST /ingest/schedule         — pull ESPN schedule → TeamSchedule rows
POST /ingest/projections      — pull NBA Stats averages → PlayerProjection rows
POST /ingest/all              — schedule then projections in one call
GET  /schedule                — view stored games-per-week for roster teams
GET  /projections             — view stored projections (optional ?week=21|22|23)
GET  /optimize                — run ILP optimizer (optional ?week=21|22|23)
"""

from contextlib import asynccontextmanager
from dataclasses import asdict

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import dispose_db, get_db, init_db
from .ingestion.projections import ROSTER, ingest_projections
from .ingestion.schedule import ingest_schedule
from .models import Player, PlayerProjection, TeamSchedule
from .optimizer.lineup import LineupResult, optimize_all_weeks, optimize_lineup, PlayerInput


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await dispose_db()


app = FastAPI(
    title="Fantasy Basketball Playoff Optimizer",
    description="Optimizes weekly lineups for a 13-player roster over a 3-week playoff.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------
class HealthResponse(BaseModel):
    status: str


class IngestScheduleResponse(BaseModel):
    status: str
    # {week_num_str: {team: games_count}}
    schedule: dict[str, dict[str, int]]


class IngestResponse(BaseModel):
    status: str
    message: str


class ScheduleRow(BaseModel):
    team: str
    week_num: int
    week_start: str
    week_end: str
    games_count: int


class ProjectionRow(BaseModel):
    player: str
    team: str
    week_num: int
    games_count: int
    pts_pg: float
    reb_pg: float
    ast_pg: float
    stl_pg: float
    blk_pg: float
    tov_pg: float
    tpm_pg: float
    fg_pct: float
    ft_pct: float
    fantasy_ppg: float
    projected_total: float


class SlotAssignmentResponse(BaseModel):
    slot: str
    player: str
    projected_total: float


class WeeklyLineupResponse(BaseModel):
    week_num: int
    starters: list[SlotAssignmentResponse]
    bench: list[str]
    total_projected: float


def _lineup_to_response(result: LineupResult) -> WeeklyLineupResponse:
    return WeeklyLineupResponse(
        week_num=result.week_num,
        starters=[
            SlotAssignmentResponse(
                slot=s.slot, player=s.player, projected_total=s.projected_total
            )
            for s in result.starters
        ],
        bench=result.bench,
        total_projected=result.total_projected,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse, tags=["meta"])
async def health():
    return {"status": "ok"}


@app.post("/ingest/schedule", response_model=IngestScheduleResponse, tags=["ingestion"])
async def run_ingest_schedule(db: AsyncSession = Depends(get_db)):
    """
    Fetch the ESPN NBA schedule for playoff weeks 21–23 and upsert
    TeamSchedule rows.  Takes ~5 s (one HTTP request per day × 21 days).
    """
    schedule = await ingest_schedule(db)
    return IngestScheduleResponse(
        status="ok",
        schedule={str(k): v for k, v in schedule.items()},
    )


@app.post("/ingest/projections", response_model=IngestResponse, tags=["ingestion"])
async def run_ingest_projections(db: AsyncSession = Depends(get_db)):
    """
    Seed roster players then fetch NBA season-average per-game stats and
    upsert PlayerProjection rows.  Requires schedule rows to already exist.
    """
    await ingest_projections(db)
    return IngestResponse(status="ok", message="Projections ingested for all 3 playoff weeks.")


@app.post("/ingest/all", response_model=IngestScheduleResponse, tags=["ingestion"])
async def run_ingest_all(db: AsyncSession = Depends(get_db)):
    """Run schedule ingestion then projections ingestion in one request."""
    schedule = await ingest_schedule(db)
    await ingest_projections(db)
    return IngestScheduleResponse(
        status="ok",
        schedule={str(k): v for k, v in schedule.items()},
    )


@app.get("/schedule", response_model=list[ScheduleRow], tags=["data"])
async def get_schedule(db: AsyncSession = Depends(get_db)):
    """Return stored game counts for all roster teams across playoff weeks."""
    roster_teams = {p["team"] for p in ROSTER}
    rows = (
        await db.execute(
            select(TeamSchedule)
            .where(TeamSchedule.team.in_(roster_teams))
            .order_by(TeamSchedule.week_num, TeamSchedule.team)
        )
    ).scalars().all()

    return [
        ScheduleRow(
            team=r.team,
            week_num=r.week_num,
            week_start=r.week_start.isoformat(),
            week_end=r.week_end.isoformat(),
            games_count=r.games_count,
        )
        for r in rows
    ]


@app.get("/projections", response_model=list[ProjectionRow], tags=["data"])
async def get_projections(
    week: int | None = Query(default=None, ge=21, le=23),
    db: AsyncSession = Depends(get_db),
):
    """
    Return stored projections.  Optionally filter by ?week=21|22|23.
    """
    stmt = (
        select(Player, PlayerProjection)
        .join(PlayerProjection, Player.id == PlayerProjection.player_id)
        .order_by(PlayerProjection.week_num, PlayerProjection.projected_total.desc())
    )
    if week is not None:
        stmt = stmt.where(PlayerProjection.week_num == week)

    rows = (await db.execute(stmt)).all()

    return [
        ProjectionRow(
            player=player.name,
            team=player.team,
            week_num=proj.week_num,
            games_count=proj.games_count,
            pts_pg=proj.pts_pg,
            reb_pg=proj.reb_pg,
            ast_pg=proj.ast_pg,
            stl_pg=proj.stl_pg,
            blk_pg=proj.blk_pg,
            tov_pg=proj.tov_pg,
            tpm_pg=proj.tpm_pg,
            fg_pct=proj.fg_pct,
            ft_pct=proj.ft_pct,
            fantasy_ppg=proj.fantasy_ppg,
            projected_total=proj.projected_total,
        )
        for player, proj in rows
    ]


@app.get("/optimize", response_model=list[WeeklyLineupResponse], tags=["optimizer"])
async def run_optimize(
    week: int | None = Query(default=None, ge=21, le=23),
    db: AsyncSession = Depends(get_db),
):
    """
    Run the ILP lineup optimizer.  Returns optimal starters + bench per week.
    Optionally restrict to a single week with ?week=21|22|23.
    """
    if week is not None:
        # Single-week optimisation
        rows = (
            await db.execute(
                select(Player, PlayerProjection)
                .join(PlayerProjection, Player.id == PlayerProjection.player_id)
                .where(PlayerProjection.week_num == week)
            )
        ).all()

        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"No projection data for week {week}. Run /ingest/all first.",
            )

        players = [
            PlayerInput(
                name=player.name,
                positions=player.positions,
                projected_total=proj.projected_total,
            )
            for player, proj in rows
        ]
        result = optimize_lineup(players, week)
        return [_lineup_to_response(result)]

    # All 3 weeks
    results = await optimize_all_weeks(db)
    if not results:
        raise HTTPException(
            status_code=404,
            detail="No projection data found. Run /ingest/all first.",
        )
    return [_lineup_to_response(r) for r in results]
