"""
FastAPI application entry point.

Public endpoints (no auth):
  GET  /health
  POST /ingest/schedule
  POST /ingest/all
  GET  /schedule/all
  GET  /team-days
  GET  /players/search

Protected endpoints (Bearer token required):
  GET  /schedule               — user's roster teams
  GET  /projections
  POST /ingest/projections
  GET  /optimize
  GET  /calendar
  GET  /player-grid
  POST /simulate-schedule
  GET  /players/info/{id}
  GET  /roster  /POST /roster  etc.
  GET/POST/PUT/DELETE /saved-rosters
"""

from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from pydantic import BaseModel
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .auth_utils import get_current_user
from .database import dispose_db, get_db, init_db
from .limiter import limiter
from .ingestion.projections import ingest_projections
from .ingestion.schedule import PLAYOFF_WEEKS, expand_team_set, ingest_schedule, normalize_team_abbr
from .ingestion.source import get_active_source
from .models import GameDay, Player, PlayerProjection, SavedRoster, TeamSchedule, User, YahooLeagueTeam
from .optimizer.daily import DailyPlayer, optimize_daily_lineup
from .optimizer.lineup import LineupResult, optimize_all_weeks, optimize_lineup, PlayerInput
from .routers.auth import router as auth_router
from .routers.ingestion import router as ingestion_ext_router
from .routers.league import router as league_router
from .routers.projections import router as projections_router
from .routers.users import router as users_router


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await dispose_db()


app = FastAPI(
    title="Fantasy Basketball Playoff Optimizer",
    description="Multi-user optimizer for a 3-week fantasy basketball playoff.",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

import os as _os
import re as _re

_ALLOWED_ORIGINS_ENV = _os.getenv("ALLOWED_ORIGINS", "")
_EXTRA_ORIGINS: list[str] = [o.strip() for o in _ALLOWED_ORIGINS_ENV.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?|https://[a-z0-9][a-z0-9\-]*\.vercel\.app",
    allow_origins=_EXTRA_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users_router)
app.include_router(auth_router)
app.include_router(ingestion_ext_router)
app.include_router(projections_router)
app.include_router(league_router)


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------
class HealthResponse(BaseModel):
    status: str


class IngestScheduleResponse(BaseModel):
    status: str
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


class DailySlot(BaseModel):
    slot: str
    player: str | None = None


class DailyLineupResponse(BaseModel):
    date: str
    day_label: str
    players_available: int
    players_starting: int
    lineup: list[DailySlot]
    benched: list[str]
    all_starting: bool


class WeeklyCalendarResponse(BaseModel):
    week_num: int
    week_dates: str
    days: list[DailyLineupResponse]


class PlayerDayCell(BaseModel):
    date: str
    day_label: str
    week_num: int
    has_game: bool
    is_starting: bool


class PlayerGridRow(BaseModel):
    player: str
    team: str
    positions: list[str]
    days: list[PlayerDayCell]
    raw_totals: dict[str, int]
    playable_totals: dict[str, int]
    raw_grand_total: int
    playable_grand_total: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
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


WEEK_DATES_LABEL = {
    21: "Mar 16 – Mar 22",
    22: "Mar 23 – Mar 29",
    23: "Mar 30 – Apr 5",
}


async def _build_daily_lineups(
    db: AsyncSession, user_id: int
) -> list[WeeklyCalendarResponse]:
    """
    Core logic shared by /calendar and /player-grid.
    Loads the user's active players + their game days, runs the daily greedy
    optimizer for every day in all 3 weeks.
    """
    player_rows = (
        await db.execute(
            select(Player).where(
                Player.user_id == user_id,
                Player.is_active == True,
                Player.is_il == False,
            )
        )
    ).scalars().all()

    roster_teams = {normalize_team_abbr(p.team) for p in player_rows}

    gd_rows = (
        await db.execute(
            select(GameDay)
            .where(GameDay.team.in_(expand_team_set(roster_teams)))
            .order_by(GameDay.week_num, GameDay.game_date)
        )
    ).scalars().all()

    if not gd_rows:
        return []

    days_map: dict[int, dict[date, list[str]]] = defaultdict(lambda: defaultdict(list))
    for gd in gd_rows:
        days_map[gd.week_num][gd.game_date].append(normalize_team_abbr(gd.team))

    date_label: dict[date, str] = {gd.game_date: gd.day_label for gd in gd_rows}

    active_source = await get_active_source(db, user_id=user_id)
    proj_rows = (
        await db.execute(
            select(PlayerProjection)
            .join(Player, Player.id == PlayerProjection.player_id)
            .where(
                Player.user_id == user_id,
                PlayerProjection.source == active_source,
            )
        )
    ).scalars().all()
    ppg_map: dict[int, float] = defaultdict(float)
    ppg_count: dict[int, int] = defaultdict(int)
    for proj in proj_rows:
        ppg_map[proj.player_id] += proj.fantasy_ppg
        ppg_count[proj.player_id] += 1
    avg_ppg: dict[int, float] = {
        pid: ppg_map[pid] / ppg_count[pid] for pid in ppg_map
    }

    team_players: dict[str, list[DailyPlayer]] = defaultdict(list)
    for p in player_rows:
        team_players[normalize_team_abbr(p.team)].append(
            DailyPlayer(
                name=p.name,
                positions=p.positions,
                fantasy_ppg=avg_ppg.get(p.id, 0.0),
            )
        )

    weekly_results: list[WeeklyCalendarResponse] = []

    for week_meta in PLAYOFF_WEEKS:
        week_num = week_meta["week"]
        start_d: date = week_meta["start"]
        end_d: date = week_meta["end"]

        daily_responses: list[DailyLineupResponse] = []

        d = start_d
        while d <= end_d:
            teams_today = days_map[week_num].get(d, [])
            label = date_label.get(d, f"{d.strftime('%a')} {d.month}/{d.day}")

            players_today: list[DailyPlayer] = []
            for team in teams_today:
                players_today.extend(team_players.get(team, []))

            result = optimize_daily_lineup(players_today)

            daily_responses.append(DailyLineupResponse(
                date=d.isoformat(),
                day_label=label,
                players_available=result.total_available,
                players_starting=result.total_playing,
                lineup=[
                    DailySlot(slot=slot, player=result.lineup.get(slot))
                    for slot in ["PG", "SG", "G", "SF", "PF", "F", "C1", "C2", "UTIL1", "UTIL2"]
                ],
                benched=result.benched,
                all_starting=len(result.benched) == 0,
            ))
            d = date.fromordinal(d.toordinal() + 1)

        weekly_results.append(WeeklyCalendarResponse(
            week_num=week_num,
            week_dates=WEEK_DATES_LABEL[week_num],
            days=daily_responses,
        ))

    return weekly_results


# ---------------------------------------------------------------------------
# Public routes
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse, tags=["meta"])
async def health():
    return {"status": "ok"}


@app.post("/ingest/schedule", response_model=IngestScheduleResponse, tags=["ingestion"])
async def run_ingest_schedule(
    force: bool = Query(default=False, description="Re-fetch from ESPN even if data exists"),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch ESPN schedule → upsert TeamSchedule + GameDay rows (shared data, no auth).
    Skips the ESPN API call if schedule data already exists unless force=true.
    """
    schedule = await ingest_schedule(db, force=force)
    return IngestScheduleResponse(
        status="ok",
        schedule={str(k): v for k, v in schedule.items()},
    )


@app.post("/ingest/all", response_model=IngestScheduleResponse, tags=["ingestion"])
async def run_ingest_all(
    force: bool = Query(default=False, description="Re-fetch from ESPN even if data exists"),
    db: AsyncSession = Depends(get_db),
):
    """
    Run schedule ingestion (public). Skips the ESPN call if data already exists
    unless force=true.
    """
    schedule = await ingest_schedule(db, force=force)
    return IngestScheduleResponse(
        status="ok",
        schedule={str(k): v for k, v in schedule.items()},
    )


@app.get("/schedule/all", response_model=list[ScheduleRow], tags=["data"])
async def get_schedule_all(db: AsyncSession = Depends(get_db)):
    """Return stored game counts for ALL teams across playoff weeks (no auth)."""
    rows = (
        await db.execute(
            select(TeamSchedule).order_by(TeamSchedule.week_num, TeamSchedule.team)
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


class TeamDayRow(BaseModel):
    team: str
    date: str
    week_num: int
    day_label: str


@app.get("/team-days", response_model=list[TeamDayRow], tags=["data"])
async def get_team_days(db: AsyncSession = Depends(get_db)):
    """Return every game day for every team across all 3 playoff weeks (no auth)."""
    rows = (
        await db.execute(
            select(GameDay).order_by(GameDay.week_num, GameDay.game_date, GameDay.team)
        )
    ).scalars().all()
    return [
        TeamDayRow(team=r.team, date=r.game_date.isoformat(), week_num=r.week_num, day_label=r.day_label)
        for r in rows
    ]


@app.get("/players/search", tags=["roster"])
async def search_nba_players(q: str = Query(min_length=2)):
    """Search active NBA players by name (uses local static data — no auth required)."""
    from nba_api.stats.static import players as nba_static
    matches = nba_static.find_players_by_full_name(q)
    active = [p for p in matches if p["is_active"]][:10]
    return [
        {"player_id": p["id"], "name": p["full_name"], "is_active": p["is_active"]}
        for p in active
    ]


# ---------------------------------------------------------------------------
# Protected routes — schedule
# ---------------------------------------------------------------------------
@app.get("/schedule", response_model=list[ScheduleRow], tags=["data"])
async def get_schedule(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return stored game counts for the authenticated user's roster teams."""
    active_players = (
        await db.execute(
            select(Player).where(
                Player.user_id == current_user.id,
                Player.is_active == True,
                Player.is_il == False,
            )
        )
    ).scalars().all()
    roster_teams = {normalize_team_abbr(p.team) for p in active_players}

    rows = (
        await db.execute(
            select(TeamSchedule)
            .where(TeamSchedule.team.in_(expand_team_set(roster_teams)))
            .order_by(TeamSchedule.week_num, TeamSchedule.team)
        )
    ).scalars().all()

    return [
        ScheduleRow(
            team=normalize_team_abbr(r.team),
            week_num=r.week_num,
            week_start=r.week_start.isoformat(),
            week_end=r.week_end.isoformat(),
            games_count=r.games_count,
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Protected routes — ingestion
# ---------------------------------------------------------------------------
@app.post("/ingest/projections", response_model=IngestResponse, tags=["ingestion"])
async def run_ingest_projections(
    force: bool = Query(default=False, description="Re-fetch from NBA Stats API even if fetched today"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Fetch NBA Stats season averages → PlayerProjection rows for the user's roster.
    Skips the NBA Stats API call if projections were already fetched today for this
    user (rate-limited to once per day). Pass force=true to bypass.
    """
    if not force and current_user.nba_projections_fetched_at:
        age = datetime.now(timezone.utc) - current_user.nba_projections_fetched_at
        if age < timedelta(hours=24):
            next_fetch = current_user.nba_projections_fetched_at + timedelta(hours=24)
            return IngestResponse(
                status="skipped",
                message=(
                    f"NBA stats already fetched {int(age.total_seconds() // 3600)}h ago. "
                    f"Next fetch available at {next_fetch.strftime('%Y-%m-%d %H:%M UTC')}. "
                    "Pass force=true to override."
                ),
            )

    try:
        await ingest_projections(db, user_id=current_user.id)
    except Exception as exc:
        print(f"[ingest_projections] NBA Stats API failed: {exc}")
        return IngestResponse(
            status="warning",
            message=f"NBA Stats API unavailable ({type(exc).__name__}). Use Basketball Monster CSV or Yahoo as your projection source.",
        )

    # Record the successful fetch time
    current_user.nba_projections_fetched_at = datetime.now(timezone.utc)
    await db.commit()

    return IngestResponse(status="ok", message="Projections ingested for all 3 playoff weeks.")


# ---------------------------------------------------------------------------
# Protected routes — projections view
# ---------------------------------------------------------------------------
@app.get("/projections", response_model=list[ProjectionRow], tags=["data"])
async def get_projections(
    week: int | None = Query(default=None, ge=21, le=23),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return stored projections for the authenticated user, filtered by active source."""
    active_source = await get_active_source(db, user_id=current_user.id)
    stmt = (
        select(Player, PlayerProjection)
        .join(PlayerProjection, Player.id == PlayerProjection.player_id)
        .where(
            Player.user_id == current_user.id,
            PlayerProjection.source == active_source,
        )
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


# ---------------------------------------------------------------------------
# Protected routes — optimizer
# ---------------------------------------------------------------------------
@app.get("/optimize", response_model=list[WeeklyLineupResponse], tags=["optimizer"])
async def run_optimize(
    week: int | None = Query(default=None, ge=21, le=23),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Run the ILP weekly lineup optimizer for the authenticated user's roster."""
    if week is not None:
        active_source = await get_active_source(db, user_id=current_user.id)
        rows = (
            await db.execute(
                select(Player, PlayerProjection)
                .join(PlayerProjection, Player.id == PlayerProjection.player_id)
                .where(
                    Player.user_id == current_user.id,
                    PlayerProjection.week_num == week,
                    PlayerProjection.source == active_source,
                    Player.is_active == True,
                    Player.is_il == False,
                )
            )
        ).all()

        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"No projection data for week {week}. Run /ingest/projections first.",
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

    results = await optimize_all_weeks(db, user_id=current_user.id)
    if not results:
        raise HTTPException(
            status_code=404,
            detail="No projection data found. Run /ingest/projections first.",
        )
    return [_lineup_to_response(r) for r in results]


@app.get("/calendar", response_model=list[WeeklyCalendarResponse], tags=["optimizer"])
async def get_calendar(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Daily greedy lineup optimizer across all 3 playoff weeks for the user's roster."""
    results = await _build_daily_lineups(db, user_id=current_user.id)
    if not results:
        raise HTTPException(
            status_code=404,
            detail="No schedule data found. Run /ingest/all first.",
        )
    return results


# ---------------------------------------------------------------------------
# Protected routes — roster management schemas
# ---------------------------------------------------------------------------
class NBAPlayerInfo(BaseModel):
    player_id: int
    name: str
    team: str
    nba_position: str
    positions: list[str]


class RosterAddRequest(BaseModel):
    player_id: int
    name: str
    team: str
    positions: list[str]


class RosterPlayer(BaseModel):
    name: str
    team: str
    positions: list[str]
    is_active: bool
    is_il: bool = False


# ---------------------------------------------------------------------------
# Protected routes — roster management
# ---------------------------------------------------------------------------
@app.get("/roster", response_model=list[RosterPlayer], tags=["roster"])
async def get_roster(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all active roster players for the authenticated user."""
    players = (
        await db.execute(
            select(Player)
            .where(Player.user_id == current_user.id, Player.is_active == True)
            .order_by(Player.is_il, Player.name)
        )
    ).scalars().all()
    return [
        RosterPlayer(name=p.name, team=p.team, positions=p.positions, is_active=p.is_active, is_il=p.is_il)
        for p in players
    ]


@app.get("/players/info/{player_id}", response_model=NBAPlayerInfo, tags=["roster"])
async def get_nba_player_info(
    player_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch team and position for a specific NBA player."""
    from nba_api.stats.static import players as nba_static

    static_match = next((p for p in nba_static.get_players() if p["id"] == player_id), None)
    if not static_match:
        raise HTTPException(status_code=404, detail=f"Player ID {player_id} not found.")
    player_name = static_match["full_name"]

    # Check user's own DB first
    db_player = (
        await db.execute(
            select(Player).where(
                Player.name == player_name,
                Player.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()

    if db_player and db_player.team and db_player.positions:
        return NBAPlayerInfo(
            player_id=player_id,
            name=db_player.name,
            team=db_player.team,
            nba_position="/".join(db_player.positions),
            positions=db_player.positions,
        )

    # Fall back to Yahoo Fantasy player search
    from .ingestion.yahoo import lookup_player_info
    yahoo_info = await lookup_player_info(player_name, user=current_user)
    if yahoo_info and yahoo_info.get("team"):
        team = normalize_team_abbr(yahoo_info["team"])
        positions = yahoo_info["positions"]
        return NBAPlayerInfo(
            player_id=player_id,
            name=player_name,
            team=team,
            nba_position="/".join(positions),
            positions=positions,
        )

    return NBAPlayerInfo(
        player_id=player_id,
        name=player_name,
        team="",
        nba_position="",
        positions=["SF", "PF"],
    )


@app.post("/roster", response_model=RosterPlayer, tags=["roster"])
async def add_to_roster(
    body: RosterAddRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a player to the authenticated user's active roster (max 13)."""
    existing = (
        await db.execute(
            select(Player).where(
                Player.name == body.name, Player.user_id == current_user.id
            )
        )
    ).scalar_one_or_none()

    if existing and existing.is_active:
        raise HTTPException(status_code=400, detail=f"{body.name} is already on your roster.")

    if not existing:
        count: int = (
            await db.execute(
                select(func.count(Player.id)).where(
                    Player.user_id == current_user.id,
                    Player.is_active == True,
                    Player.is_il == False,
                )
            )
        ).scalar_one()
        if count >= 13:
            raise HTTPException(
                status_code=400,
                detail="Roster is full (max 13 starters). Move a player to IL first.",
            )

    stmt = (
        pg_insert(Player)
        .values(
            name=body.name,
            team=body.team,
            positions=body.positions,
            is_active=True,
            is_il=False,
            user_id=current_user.id,
        )
        .on_conflict_do_update(
            constraint="uq_players_name_user",
            set_={"team": body.team, "positions": body.positions, "is_active": True, "is_il": False},
        )
    )
    await db.execute(stmt)
    await db.commit()

    player = (
        await db.execute(
            select(Player).where(Player.name == body.name, Player.user_id == current_user.id)
        )
    ).scalar_one()
    return RosterPlayer(name=player.name, team=player.team, positions=player.positions, is_active=True, is_il=False)


@app.delete("/roster/{player_name}", tags=["roster"])
async def remove_from_roster(
    player_name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a player from the authenticated user's roster (sets is_active=False)."""
    result = await db.execute(
        update(Player)
        .where(Player.name == player_name, Player.user_id == current_user.id)
        .values(is_active=False)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"Player '{player_name}' not found.")
    await db.commit()
    return {"status": "ok", "removed": player_name}


@app.delete("/roster", tags=["roster"])
async def clear_roster(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Deactivate all active roster players for the authenticated user."""
    await db.execute(
        update(Player)
        .where(Player.user_id == current_user.id, Player.is_active == True)
        .values(is_active=False)
    )
    await db.commit()
    return {"status": "ok"}


class LoadYahooTeamRequest(BaseModel):
    team_key: str


@app.post("/roster/load-yahoo-team", response_model=list[RosterPlayer], tags=["roster"])
async def load_yahoo_team_to_roster(
    body: LoadYahooTeamRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Replace the active roster with all players from a Yahoo league team."""
    team = (
        await db.execute(
            select(YahooLeagueTeam).where(
                YahooLeagueTeam.team_key == body.team_key,
                YahooLeagueTeam.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail=f"Yahoo team '{body.team_key}' not found.")

    roster_data: list[dict] = team.roster or []

    # Deactivate current roster
    await db.execute(
        update(Player)
        .where(Player.user_id == current_user.id, Player.is_active == True)
        .values(is_active=False)
    )

    for p_data in roster_data:
        is_il = bool(p_data.get("is_il", False))
        stmt = (
            pg_insert(Player)
            .values(
                name=p_data["name"],
                team=p_data["team"],
                positions=p_data.get("positions", []),
                is_active=True,
                is_il=is_il,
                user_id=current_user.id,
            )
            .on_conflict_do_update(
                constraint="uq_players_name_user",
                set_={
                    "team": p_data["team"],
                    "positions": p_data.get("positions", []),
                    "is_active": True,
                    "is_il": is_il,
                },
            )
        )
        await db.execute(stmt)

    await db.commit()

    return [
        RosterPlayer(
            name=p["name"],
            team=p["team"],
            positions=p.get("positions", []),
            is_active=True,
            is_il=bool(p.get("is_il", False)),
        )
        for p in roster_data
    ]


class UpdatePositionsRequest(BaseModel):
    positions: list[str]


@app.patch("/roster/{player_name}/positions", response_model=RosterPlayer, tags=["roster"])
async def update_roster_positions(
    player_name: str,
    body: UpdatePositionsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the fantasy positions for an existing roster player."""
    result = await db.execute(
        update(Player)
        .where(
            Player.name == player_name,
            Player.user_id == current_user.id,
            Player.is_active == True,
        )
        .values(positions=body.positions)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"Active player '{player_name}' not found.")
    await db.commit()
    player = (
        await db.execute(
            select(Player).where(Player.name == player_name, Player.user_id == current_user.id)
        )
    ).scalar_one()
    return RosterPlayer(name=player.name, team=player.team, positions=player.positions, is_active=player.is_active, is_il=player.is_il)


class SetILRequest(BaseModel):
    is_il: bool


@app.patch("/roster/{player_name}/il", response_model=RosterPlayer, tags=["roster"])
async def set_player_il(
    player_name: str,
    body: SetILRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle a player's IL status."""
    player = (
        await db.execute(
            select(Player).where(
                Player.name == player_name,
                Player.user_id == current_user.id,
                Player.is_active == True,
            )
        )
    ).scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail=f"Active player '{player_name}' not found.")

    if body.is_il and not player.is_il:
        il_count: int = (
            await db.execute(
                select(func.count(Player.id)).where(
                    Player.user_id == current_user.id,
                    Player.is_active == True,
                    Player.is_il == True,
                    Player.name != player_name,
                )
            )
        ).scalar_one()
        if il_count >= 3:
            raise HTTPException(status_code=400, detail="IL slots full (max 3).")
    elif not body.is_il and player.is_il:
        starter_count: int = (
            await db.execute(
                select(func.count(Player.id)).where(
                    Player.user_id == current_user.id,
                    Player.is_active == True,
                    Player.is_il == False,
                    Player.name != player_name,
                )
            )
        ).scalar_one()
        if starter_count >= 13:
            raise HTTPException(
                status_code=400,
                detail="Starter roster is full (max 13). Remove a starter first.",
            )

    await db.execute(
        update(Player)
        .where(Player.name == player_name, Player.user_id == current_user.id)
        .values(is_il=body.is_il)
    )
    await db.commit()
    player = (
        await db.execute(
            select(Player).where(Player.name == player_name, Player.user_id == current_user.id)
        )
    ).scalar_one()
    return RosterPlayer(name=player.name, team=player.team, positions=player.positions, is_active=player.is_active, is_il=player.is_il)


# ---------------------------------------------------------------------------
# Protected routes — saved rosters
# ---------------------------------------------------------------------------
class SavedRosterEntry(BaseModel):
    name: str
    team: str
    positions: list[str] = []


class SavedRosterSchema(BaseModel):
    id: int
    name: str
    players: list[SavedRosterEntry]
    created_at: str


class SavedRosterRequest(BaseModel):
    name: str
    players: list[SavedRosterEntry]


def _to_schema(r: SavedRoster) -> SavedRosterSchema:
    return SavedRosterSchema(
        id=r.id,
        name=r.name,
        players=[SavedRosterEntry(**p) for p in (r.players or [])],
        created_at=r.created_at.isoformat(),
    )


@app.get("/saved-rosters", response_model=list[SavedRosterSchema], tags=["saved-rosters"])
async def list_saved_rosters(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(SavedRoster)
            .where(SavedRoster.user_id == current_user.id)
            .order_by(SavedRoster.created_at)
        )
    ).scalars().all()
    return [_to_schema(r) for r in rows]


@app.post("/saved-rosters", response_model=SavedRosterSchema, tags=["saved-rosters"])
async def create_saved_roster(
    body: SavedRosterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = (
        await db.execute(
            select(SavedRoster).where(
                SavedRoster.name == body.name,
                SavedRoster.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"A roster named '{body.name}' already exists.")
    row = SavedRoster(
        name=body.name,
        players=[p.model_dump() for p in body.players],
        user_id=current_user.id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_schema(row)


@app.put("/saved-rosters/{roster_id}", response_model=SavedRosterSchema, tags=["saved-rosters"])
async def update_saved_roster(
    roster_id: int,
    body: SavedRosterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (
        await db.execute(
            select(SavedRoster).where(
                SavedRoster.id == roster_id,
                SavedRoster.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Saved roster not found.")
    if body.name != row.name:
        conflict = (
            await db.execute(
                select(SavedRoster).where(
                    SavedRoster.name == body.name,
                    SavedRoster.user_id == current_user.id,
                )
            )
        ).scalar_one_or_none()
        if conflict:
            raise HTTPException(status_code=400, detail=f"A roster named '{body.name}' already exists.")
    row.name = body.name
    row.players = [p.model_dump() for p in body.players]
    await db.commit()
    await db.refresh(row)
    return _to_schema(row)


@app.delete("/saved-rosters/{roster_id}", tags=["saved-rosters"])
async def delete_saved_roster(
    roster_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (
        await db.execute(
            select(SavedRoster).where(
                SavedRoster.id == roster_id,
                SavedRoster.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Saved roster not found.")
    await db.delete(row)
    await db.commit()
    return {"status": "ok", "deleted": roster_id}


@app.post("/saved-rosters/{roster_id}/activate", response_model=list[RosterPlayer], tags=["saved-rosters"])
async def activate_saved_roster(
    roster_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set the active roster to the players in a saved roster."""
    saved = (
        await db.execute(
            select(SavedRoster).where(
                SavedRoster.id == roster_id,
                SavedRoster.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if not saved:
        raise HTTPException(status_code=404, detail="Saved roster not found.")

    await db.execute(
        update(Player)
        .where(Player.user_id == current_user.id, Player.is_active == True)
        .values(is_active=False)
    )

    for entry in (saved.players or []):
        stmt = (
            pg_insert(Player)
            .values(
                name=entry["name"],
                team=entry["team"],
                positions=entry.get("positions", []),
                is_active=True,
                user_id=current_user.id,
            )
            .on_conflict_do_update(
                constraint="uq_players_name_user",
                set_={
                    "team": entry["team"],
                    "positions": entry.get("positions", []),
                    "is_active": True,
                },
            )
        )
        await db.execute(stmt)

    await db.commit()

    active = (
        await db.execute(
            select(Player)
            .where(Player.user_id == current_user.id, Player.is_active == True)
            .order_by(Player.name)
        )
    ).scalars().all()
    return [RosterPlayer(name=p.name, team=p.team, positions=p.positions, is_active=True) for p in active]


# ---------------------------------------------------------------------------
# Protected routes — schedule simulation
# ---------------------------------------------------------------------------
class PlayerWeekStarts(BaseModel):
    week_num: int
    starts: int
    raw_games: int


class SimulatePlayerResult(BaseModel):
    name: str
    team: str
    weeks: list[PlayerWeekStarts]
    total_starts: int
    total_raw_games: int


class SimulateScheduleResponse(BaseModel):
    players: list[SimulatePlayerResult]


class SimulateScheduleRequest(BaseModel):
    players: list[SavedRosterEntry]


@app.post("/simulate-schedule", response_model=SimulateScheduleResponse, tags=["optimizer"])
async def simulate_schedule(
    body: SimulateScheduleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Given an arbitrary player list, simulate the daily greedy optimizer for all
    3 playoff weeks and return per-player playable starts.
    """
    if not body.players:
        return SimulateScheduleResponse(players=[])

    sim_teams = {normalize_team_abbr(p.team) for p in body.players}

    gd_rows = (
        await db.execute(
            select(GameDay)
            .where(GameDay.team.in_(expand_team_set(sim_teams)))
            .order_by(GameDay.week_num, GameDay.game_date)
        )
    ).scalars().all()

    days_map: dict[int, dict[date, list[str]]] = defaultdict(lambda: defaultdict(list))
    for gd in gd_rows:
        days_map[gd.week_num][gd.game_date].append(normalize_team_abbr(gd.team))

    team_players: dict[str, list[DailyPlayer]] = defaultdict(list)
    for p in body.players:
        team_players[normalize_team_abbr(p.team)].append(
            DailyPlayer(name=p.name, positions=p.positions or [], fantasy_ppg=0.0)
        )

    starts: dict[str, dict[int, int]] = {p.name: {21: 0, 22: 0, 23: 0} for p in body.players}
    raw_games: dict[str, dict[int, int]] = {p.name: {21: 0, 22: 0, 23: 0} for p in body.players}

    for week_meta in PLAYOFF_WEEKS:
        week_num = week_meta["week"]
        start_d: date = week_meta["start"]
        end_d: date = week_meta["end"]

        d = start_d
        while d <= end_d:
            teams_today = days_map[week_num].get(d, [])

            for team in teams_today:
                for player in team_players.get(team, []):
                    raw_games[player.name][week_num] += 1

            players_today: list[DailyPlayer] = []
            for team in teams_today:
                players_today.extend(team_players.get(team, []))

            result = optimize_daily_lineup(players_today)

            for slot_player in result.lineup.values():
                if slot_player and slot_player in starts:
                    starts[slot_player][week_num] += 1

            d = date.fromordinal(d.toordinal() + 1)

    player_results = [
        SimulatePlayerResult(
            name=p.name,
            team=p.team,
            weeks=[
                PlayerWeekStarts(
                    week_num=wk,
                    starts=starts[p.name][wk],
                    raw_games=raw_games[p.name][wk],
                )
                for wk in [21, 22, 23]
            ],
            total_starts=sum(starts[p.name].values()),
            total_raw_games=sum(raw_games[p.name].values()),
        )
        for p in body.players
    ]

    return SimulateScheduleResponse(players=player_results)


# ---------------------------------------------------------------------------
# Protected routes — player grid
# ---------------------------------------------------------------------------
@app.get("/player-grid", response_model=list[PlayerGridRow], tags=["data"])
async def get_player_grid(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Player × day grid for all 21 playoff days (authenticated user's roster)."""
    calendar = await _build_daily_lineups(db, user_id=current_user.id)
    if not calendar:
        raise HTTPException(
            status_code=404,
            detail="No schedule data found. Run /ingest/all first.",
        )

    starting_map: dict[tuple[str, str], bool] = {}
    for week_cal in calendar:
        for day in week_cal.days:
            for slot in day.lineup:
                if slot.player:
                    starting_map[(slot.player, day.date)] = True
            for benched in day.benched:
                starting_map[(benched, day.date)] = False

    all_days: list[tuple[str, str, int]] = []
    for week_cal in calendar:
        for day in week_cal.days:
            all_days.append((day.date, day.day_label, week_cal.week_num))

    player_rows = (
        await db.execute(
            select(Player).where(
                Player.user_id == current_user.id,
                Player.is_active == True,
                Player.is_il == False,
            )
        )
    ).scalars().all()

    roster_teams = {normalize_team_abbr(p.team) for p in player_rows}
    gd_rows = (
        await db.execute(
            select(GameDay).where(GameDay.team.in_(expand_team_set(roster_teams)))
        )
    ).scalars().all()
    team_game_dates: dict[str, set[str]] = defaultdict(set)
    for gd in gd_rows:
        team_game_dates[normalize_team_abbr(gd.team)].add(gd.game_date.isoformat())

    grid: list[PlayerGridRow] = []
    for p in sorted(player_rows, key=lambda x: x.name):
        days: list[PlayerDayCell] = []
        raw_totals: dict[str, int] = {"21": 0, "22": 0, "23": 0}
        playable_totals: dict[str, int] = {"21": 0, "22": 0, "23": 0}

        for date_str, label, week_num in all_days:
            has_game = date_str in team_game_dates.get(normalize_team_abbr(p.team), set())
            is_starting = starting_map.get((p.name, date_str), False) if has_game else False

            days.append(PlayerDayCell(
                date=date_str,
                day_label=label,
                week_num=week_num,
                has_game=has_game,
                is_starting=is_starting,
            ))

            wk = str(week_num)
            if has_game:
                raw_totals[wk] = raw_totals.get(wk, 0) + 1
            if is_starting:
                playable_totals[wk] = playable_totals.get(wk, 0) + 1

        grid.append(PlayerGridRow(
            player=p.name,
            team=p.team,
            positions=p.positions,
            days=days,
            raw_totals=raw_totals,
            playable_totals=playable_totals,
            raw_grand_total=sum(raw_totals.values()),
            playable_grand_total=sum(playable_totals.values()),
        ))

    return grid
