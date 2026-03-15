"""  # noqa
FastAPI application entry point.

Endpoints
---------
GET  /health                  — liveness check
POST /ingest/schedule         — pull ESPN schedule → TeamSchedule + GameDay rows
POST /ingest/projections      — pull NBA Stats averages → PlayerProjection rows
POST /ingest/all              — schedule then projections in one call
GET  /schedule                — games-per-week for roster teams
GET  /projections             — stored projections (optional ?week=21|22|23)
GET  /optimize                — ILP weekly lineup optimizer (optional ?week=21|22|23)
GET  /calendar                — daily greedy lineup for every day of all 3 weeks
GET  /player-grid             — player × day game/start matrix with raw vs playable totals
"""

import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .database import dispose_db, get_db, init_db
from .ingestion.projections import ROSTER, ingest_projections, map_nba_position
from .ingestion.schedule import PLAYOFF_WEEKS, expand_team_set, ingest_schedule, normalize_team_abbr
from .ingestion.source import get_active_source
from .models import GameDay, Player, PlayerProjection, SavedRoster, TeamSchedule, YahooLeagueTeam
from .optimizer.daily import DailyPlayer, optimize_daily_lineup
from .optimizer.lineup import LineupResult, optimize_all_weeks, optimize_lineup, PlayerInput
from .routers.auth import router as auth_router
from .routers.ingestion import router as ingestion_ext_router
from .routers.projections import router as projections_router
from .routers.league import router as league_router


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
    version="0.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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


# Calendar schemas
class DailySlot(BaseModel):
    slot: str
    player: str | None = None


class DailyLineupResponse(BaseModel):
    date: str           # "2026-03-16"
    day_label: str      # "Mon 3/16"
    players_available: int
    players_starting: int
    lineup: list[DailySlot]   # 10 slots in order
    benched: list[str]
    all_starting: bool  # True when no one is benched


class WeeklyCalendarResponse(BaseModel):
    week_num: int
    week_dates: str     # "Mar 16 – Mar 22"
    days: list[DailyLineupResponse]


# Player grid schemas
class PlayerDayCell(BaseModel):
    date: str
    day_label: str
    week_num: int
    has_game: bool
    is_starting: bool   # True if the daily optimizer put them in a slot


class PlayerGridRow(BaseModel):
    player: str
    team: str
    positions: list[str]
    days: list[PlayerDayCell]                  # all 21 days
    raw_totals: dict[str, int]                 # week_num str → raw games
    playable_totals: dict[str, int]            # week_num str → startable days
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


async def _build_daily_lineups(db: AsyncSession) -> list[WeeklyCalendarResponse]:
    """
    Core logic shared by /calendar and /player-grid.
    Loads GameDay + Player rows, runs the daily greedy optimizer for every
    day in all 3 weeks, and returns structured WeeklyCalendarResponse objects.
    """
    # Load roster players with their fantasy_ppg (for tie-breaking in greedy) — IL excluded
    player_rows = (await db.execute(select(Player).where(Player.is_active == True, Player.is_il == False))).scalars().all()

    roster_teams = {normalize_team_abbr(p.team) for p in player_rows} or {normalize_team_abbr(p["team"]) for p in ROSTER}

    # Load all game days for roster teams (expand to cover old/new abbreviation variants)
    gd_rows = (
        await db.execute(
            select(GameDay)
            .where(GameDay.team.in_(expand_team_set(roster_teams)))
            .order_by(GameDay.week_num, GameDay.game_date)
        )
    ).scalars().all()

    if not gd_rows:
        return []

    # Build {week_num: {game_date: [team, ...]}} — normalize team keys
    days_map: dict[int, dict[date, list[str]]] = defaultdict(lambda: defaultdict(list))
    for gd in gd_rows:
        days_map[gd.week_num][gd.game_date].append(normalize_team_abbr(gd.team))

    # Also keep date → label map
    date_label: dict[date, str] = {gd.game_date: gd.day_label for gd in gd_rows}
    # fantasy_ppg per player (average across weeks, filtered by active source)
    active_source = await get_active_source(db)
    proj_rows = (
        await db.execute(
            select(PlayerProjection).where(PlayerProjection.source == active_source)
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

    # Build player lookup: team → list[DailyPlayer] (normalize team keys)
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

            # Collect roster players with games today
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
# Routes
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse, tags=["meta"])
async def health():
    return {"status": "ok"}


@app.post("/ingest/schedule", response_model=IngestScheduleResponse, tags=["ingestion"])
async def run_ingest_schedule(db: AsyncSession = Depends(get_db)):
    """Fetch ESPN schedule → upsert TeamSchedule + GameDay rows."""
    schedule = await ingest_schedule(db)
    return IngestScheduleResponse(
        status="ok",
        schedule={str(k): v for k, v in schedule.items()},
    )


@app.post("/ingest/projections", response_model=IngestResponse, tags=["ingestion"])
async def run_ingest_projections(db: AsyncSession = Depends(get_db)):
    """Seed players then fetch NBA Stats season averages → PlayerProjection rows."""
    await ingest_projections(db)
    return IngestResponse(status="ok", message="Projections ingested for all 3 playoff weeks.")


@app.post("/ingest/all", response_model=IngestScheduleResponse, tags=["ingestion"])
async def run_ingest_all(db: AsyncSession = Depends(get_db)):
    """Run schedule ingestion only (fast).
    NBA Stats projections are intentionally excluded — they hit a slow external API
    that causes Railway HTTP timeouts. Use POST /ingest/projections explicitly if needed.
    """
    schedule = await ingest_schedule(db)
    return IngestScheduleResponse(
        status="ok",
        schedule={str(k): v for k, v in schedule.items()},
    )


@app.get("/schedule", response_model=list[ScheduleRow], tags=["data"])
async def get_schedule(db: AsyncSession = Depends(get_db)):
    """Return stored game counts for all active-roster teams across playoff weeks."""
    active_players = (
        await db.execute(select(Player).where(Player.is_active == True, Player.is_il == False))
    ).scalars().all()
    roster_teams = {normalize_team_abbr(p.team) for p in active_players} or {normalize_team_abbr(p["team"]) for p in ROSTER}
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


@app.get("/schedule/all", response_model=list[ScheduleRow], tags=["data"])
async def get_schedule_all(db: AsyncSession = Depends(get_db)):
    """Return stored game counts for ALL teams in the DB across playoff weeks."""
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
    """Return every game day for every team across all 3 playoff weeks."""
    rows = (
        await db.execute(
            select(GameDay).order_by(GameDay.week_num, GameDay.game_date, GameDay.team)
        )
    ).scalars().all()
    return [
        TeamDayRow(team=r.team, date=r.game_date.isoformat(), week_num=r.week_num, day_label=r.day_label)
        for r in rows
    ]


@app.get("/projections", response_model=list[ProjectionRow], tags=["data"])
async def get_projections(
    week: int | None = Query(default=None, ge=21, le=23),
    db: AsyncSession = Depends(get_db),
):
    """Return stored projections filtered by active source. Optionally filter by ?week=21|22|23."""
    active_source = await get_active_source(db)
    stmt = (
        select(Player, PlayerProjection)
        .join(PlayerProjection, Player.id == PlayerProjection.player_id)
        .where(PlayerProjection.source == active_source)
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
    Run the ILP weekly lineup optimizer. Returns optimal starters + bench per week.
    Optionally restrict to a single week with ?week=21|22|23.
    """
    if week is not None:
        active_source = await get_active_source(db)
        rows = (
            await db.execute(
                select(Player, PlayerProjection)
                .join(PlayerProjection, Player.id == PlayerProjection.player_id)
                .where(
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

    results = await optimize_all_weeks(db)
    if not results:
        raise HTTPException(
            status_code=404,
            detail="No projection data found. Run /ingest/all first.",
        )
    return [_lineup_to_response(r) for r in results]


@app.get("/calendar", response_model=list[WeeklyCalendarResponse], tags=["optimizer"])
async def get_calendar(db: AsyncSession = Depends(get_db)):
    """
    Daily greedy lineup optimizer across all 3 playoff weeks.
    For each day shows which roster players have games, their slot assignments,
    and who gets benched due to position constraints.
    """
    results = await _build_daily_lineups(db)
    if not results:
        raise HTTPException(
            status_code=404,
            detail="No schedule data found. Run /ingest/all first.",
        )
    return results


# ---------------------------------------------------------------------------
# Roster management schemas
# ---------------------------------------------------------------------------
class NBAPlayerSearchResult(BaseModel):
    player_id: int
    name: str
    is_active: bool


class NBAPlayerInfo(BaseModel):
    player_id: int
    name: str
    team: str
    nba_position: str
    positions: list[str]   # mapped fantasy positions


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
# Roster management routes
# ---------------------------------------------------------------------------
@app.get("/roster", response_model=list[RosterPlayer], tags=["roster"])
async def get_roster(db: AsyncSession = Depends(get_db)):
    """Return all active roster players (starters + IL)."""
    players = (
        await db.execute(
            select(Player).where(Player.is_active == True).order_by(Player.is_il, Player.name)
        )
    ).scalars().all()
    return [
        RosterPlayer(name=p.name, team=p.team, positions=p.positions, is_active=p.is_active, is_il=p.is_il)
        for p in players
    ]


@app.get("/players/search", response_model=list[NBAPlayerSearchResult], tags=["roster"])
async def search_nba_players(q: str = Query(min_length=2)):
    """Search active NBA players by name (uses local nba_api static data — no API call)."""
    from nba_api.stats.static import players as nba_static

    matches = nba_static.find_players_by_full_name(q)
    active = [p for p in matches if p["is_active"]][:10]
    return [
        NBAPlayerSearchResult(player_id=p["id"], name=p["full_name"], is_active=p["is_active"])
        for p in active
    ]


@app.get("/players/info/{player_id}", response_model=NBAPlayerInfo, tags=["roster"])
async def get_nba_player_info(player_id: int, db: AsyncSession = Depends(get_db)):
    """Fetch team and position for a specific NBA player.

    Checks the DB first (populated during Yahoo league sync) to avoid slow
    external API calls. Falls back to the NBA Stats API only if the player
    is not in the DB.
    """
    from nba_api.stats.static import players as nba_static

    # Resolve name from local static data (no network call)
    static_match = next((p for p in nba_static.get_players() if p["id"] == player_id), None)
    if not static_match:
        raise HTTPException(status_code=404, detail=f"Player ID {player_id} not found in NBA static data.")
    player_name = static_match["full_name"]

    # Try DB first — fast path for all Yahoo-rostered players
    db_player = (
        await db.execute(select(Player).where(Player.name == player_name))
    ).scalar_one_or_none()

    if db_player and db_player.team and db_player.positions:
        return NBAPlayerInfo(
            player_id=player_id,
            name=db_player.name,
            team=db_player.team,
            nba_position="/".join(db_player.positions),
            positions=db_player.positions,
        )

    # Fall back to external NBA Stats API — only for players not yet in DB.
    # Use a short timeout so Railway doesn't hang; if it fails, raise a clear error.
    from nba_api.stats.endpoints import commonplayerinfo
    def _fetch():
        info = commonplayerinfo.CommonPlayerInfo(player_id=player_id, timeout=8)
        df = info.get_data_frames()[0]
        row = df.iloc[0]
        return {
            "name": str(row.get("DISPLAY_FIRST_LAST", "")),
            "team": str(row.get("TEAM_ABBREVIATION", "")),
            "nba_position": str(row.get("POSITION", "F")),
        }

    try:
        data = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _fetch),
            timeout=10,
        )
    except (asyncio.TimeoutError, Exception):
        # External API unavailable — return what we know so the user can still add
        # the player and set positions manually via the roster position editor.
        return NBAPlayerInfo(
            player_id=player_id,
            name=player_name,
            team="",
            nba_position="",
            positions=["SF", "PF"],
        )

    team = normalize_team_abbr(data["team"])
    positions = map_nba_position(data["nba_position"])

    return NBAPlayerInfo(
        player_id=player_id,
        name=data["name"],
        team=team,
        nba_position=data["nba_position"],
        positions=positions,
    )


@app.post("/roster", response_model=RosterPlayer, tags=["roster"])
async def add_to_roster(body: RosterAddRequest, db: AsyncSession = Depends(get_db)):
    """
    Add a player to the active roster (max 13).
    If the player already exists but is inactive, reactivates them.
    After adding, hit POST /ingest/projections to get their stats.
    """
    # Check if already on roster
    existing = (
        await db.execute(select(Player).where(Player.name == body.name))
    ).scalar_one_or_none()

    if existing and existing.is_active:
        raise HTTPException(status_code=400, detail=f"{body.name} is already on your roster.")

    # Check max size (only if this is a new player, not a reactivation)
    if not existing:
        count: int = (
            await db.execute(
                select(func.count(Player.id)).where(Player.is_active == True, Player.is_il == False)
            )
        ).scalar_one()
        if count >= 13:
            raise HTTPException(status_code=400, detail="Roster is full (max 13 starters). Move a player to IL first.")

    # Upsert player (always added as starter; use /roster/{name}/il to move to IL)
    stmt = (
        pg_insert(Player)
        .values(
            name=body.name,
            team=body.team,
            positions=body.positions,
            is_active=True,
            is_il=False,
        )
        .on_conflict_do_update(
            constraint="uq_players_name",
            set_={"team": body.team, "positions": body.positions, "is_active": True, "is_il": False},
        )
    )
    await db.execute(stmt)
    await db.commit()

    player = (
        await db.execute(select(Player).where(Player.name == body.name))
    ).scalar_one()
    return RosterPlayer(name=player.name, team=player.team, positions=player.positions, is_active=True, is_il=False)


@app.delete("/roster/{player_name}", tags=["roster"])
async def remove_from_roster(player_name: str, db: AsyncSession = Depends(get_db)):
    """Remove a player from the active roster (sets is_active=False)."""
    result = await db.execute(
        update(Player).where(Player.name == player_name).values(is_active=False)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"Player '{player_name}' not found.")
    await db.commit()
    return {"status": "ok", "removed": player_name}


@app.delete("/roster", tags=["roster"])
async def clear_roster(db: AsyncSession = Depends(get_db)):
    """Deactivate all active roster players at once."""
    await db.execute(update(Player).where(Player.is_active == True).values(is_active=False))
    await db.commit()
    return {"status": "ok"}


class LoadYahooTeamRequest(BaseModel):
    team_key: str


@app.post("/roster/load-yahoo-team", response_model=list[RosterPlayer], tags=["roster"])
async def load_yahoo_team_to_roster(body: LoadYahooTeamRequest, db: AsyncSession = Depends(get_db)):
    """Replace the active roster with all players from a Yahoo league team."""
    team = (
        await db.execute(select(YahooLeagueTeam).where(YahooLeagueTeam.team_key == body.team_key))
    ).scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail=f"Yahoo team '{body.team_key}' not found.")

    roster_data: list[dict] = team.roster or []

    # Deactivate current roster
    await db.execute(update(Player).where(Player.is_active == True).values(is_active=False))

    # Upsert each player — respect Yahoo's IL slot status from DB
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
            )
            .on_conflict_do_update(
                constraint="uq_players_name",
                set_={"team": p_data["team"], "positions": p_data.get("positions", []), "is_active": True, "is_il": is_il},
            )
        )
        await db.execute(stmt)

    await db.commit()

    # Return directly from the JSONB dict — avoids SQLAlchemy identity-map returning stale ORM objects
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
    player_name: str, body: UpdatePositionsRequest, db: AsyncSession = Depends(get_db)
):
    """Update the fantasy positions for an existing roster player."""
    result = await db.execute(
        update(Player)
        .where(Player.name == player_name, Player.is_active == True)
        .values(positions=body.positions)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"Active player '{player_name}' not found.")
    await db.commit()
    player = (
        await db.execute(select(Player).where(Player.name == player_name))
    ).scalar_one()
    return RosterPlayer(name=player.name, team=player.team, positions=player.positions, is_active=player.is_active, is_il=player.is_il)


class SetILRequest(BaseModel):
    is_il: bool


@app.patch("/roster/{player_name}/il", response_model=RosterPlayer, tags=["roster"])
async def set_player_il(
    player_name: str, body: SetILRequest, db: AsyncSession = Depends(get_db)
):
    """Toggle a player's IL status. IL players stay on the roster but are excluded from optimizer/calendar."""
    player = (
        await db.execute(select(Player).where(Player.name == player_name, Player.is_active == True))
    ).scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail=f"Active player '{player_name}' not found.")

    if body.is_il and not player.is_il:
        # Moving to IL — check limit
        il_count: int = (
            await db.execute(
                select(func.count(Player.id))
                .where(Player.is_active == True, Player.is_il == True, Player.name != player_name)
            )
        ).scalar_one()
        if il_count >= 3:
            raise HTTPException(status_code=400, detail="IL slots full (max 3).")
    elif not body.is_il and player.is_il:
        # Moving to starters — check limit
        starter_count: int = (
            await db.execute(
                select(func.count(Player.id))
                .where(Player.is_active == True, Player.is_il == False, Player.name != player_name)
            )
        ).scalar_one()
        if starter_count >= 13:
            raise HTTPException(status_code=400, detail="Starter roster is full (max 13). Remove a starter first.")

    await db.execute(update(Player).where(Player.name == player_name).values(is_il=body.is_il))
    await db.commit()
    player = (await db.execute(select(Player).where(Player.name == player_name))).scalar_one()
    return RosterPlayer(name=player.name, team=player.team, positions=player.positions, is_active=player.is_active, is_il=player.is_il)


# ---------------------------------------------------------------------------
# Saved roster schemas + routes
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


class RenameSavedRosterRequest(BaseModel):
    name: str


def _to_schema(r: SavedRoster) -> SavedRosterSchema:
    return SavedRosterSchema(
        id=r.id,
        name=r.name,
        players=[SavedRosterEntry(**p) for p in (r.players or [])],
        created_at=r.created_at.isoformat(),
    )


@app.get("/saved-rosters", response_model=list[SavedRosterSchema], tags=["saved-rosters"])
async def list_saved_rosters(db: AsyncSession = Depends(get_db)):
    """Return all saved rosters ordered by creation time."""
    rows = (
        await db.execute(select(SavedRoster).order_by(SavedRoster.created_at))
    ).scalars().all()
    return [_to_schema(r) for r in rows]


@app.post("/saved-rosters", response_model=SavedRosterSchema, tags=["saved-rosters"])
async def create_saved_roster(body: SavedRosterRequest, db: AsyncSession = Depends(get_db)):
    """Create a new named roster snapshot."""
    existing = (
        await db.execute(select(SavedRoster).where(SavedRoster.name == body.name))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"A roster named '{body.name}' already exists.")
    row = SavedRoster(name=body.name, players=[p.model_dump() for p in body.players])
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_schema(row)


@app.put("/saved-rosters/{roster_id}", response_model=SavedRosterSchema, tags=["saved-rosters"])
async def update_saved_roster(
    roster_id: int, body: SavedRosterRequest, db: AsyncSession = Depends(get_db)
):
    """Replace the name and player list of a saved roster."""
    row = (
        await db.execute(select(SavedRoster).where(SavedRoster.id == roster_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Saved roster not found.")
    # Check name uniqueness if changing
    if body.name != row.name:
        conflict = (
            await db.execute(select(SavedRoster).where(SavedRoster.name == body.name))
        ).scalar_one_or_none()
        if conflict:
            raise HTTPException(status_code=400, detail=f"A roster named '{body.name}' already exists.")
    row.name = body.name
    row.players = [p.model_dump() for p in body.players]
    await db.commit()
    await db.refresh(row)
    return _to_schema(row)


@app.delete("/saved-rosters/{roster_id}", tags=["saved-rosters"])
async def delete_saved_roster(roster_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a saved roster."""
    row = (
        await db.execute(select(SavedRoster).where(SavedRoster.id == roster_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Saved roster not found.")
    await db.delete(row)
    await db.commit()
    return {"status": "ok", "deleted": roster_id}


@app.post("/saved-rosters/{roster_id}/activate", response_model=list[RosterPlayer], tags=["saved-rosters"])
async def activate_saved_roster(roster_id: int, db: AsyncSession = Depends(get_db)):
    """
    Set the active roster to the players in this saved roster.
    Deactivates all current active players, then activates (or inserts) each
    player from the saved roster.
    """
    saved = (
        await db.execute(select(SavedRoster).where(SavedRoster.id == roster_id))
    ).scalar_one_or_none()
    if not saved:
        raise HTTPException(status_code=404, detail="Saved roster not found.")

    # Deactivate everyone currently active
    await db.execute(update(Player).where(Player.is_active == True).values(is_active=False))

    # Activate/insert each player from the saved roster
    for entry in (saved.players or []):
        stmt = (
            pg_insert(Player)
            .values(
                name=entry["name"],
                team=entry["team"],
                positions=entry.get("positions", []),
                is_active=True,
            )
            .on_conflict_do_update(
                constraint="uq_players_name",
                set_={"team": entry["team"], "positions": entry.get("positions", []), "is_active": True},
            )
        )
        await db.execute(stmt)

    await db.commit()

    active = (
        await db.execute(select(Player).where(Player.is_active == True).order_by(Player.name))
    ).scalars().all()
    return [RosterPlayer(name=p.name, team=p.team, positions=p.positions, is_active=True) for p in active]


# ---------------------------------------------------------------------------
# Schedule simulation schemas + route
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
async def simulate_schedule(body: SimulateScheduleRequest, db: AsyncSession = Depends(get_db)):
    """
    Given an arbitrary player list (with team + positions), simulate the daily greedy
    optimizer for all 3 playoff weeks and return per-player playable starts.
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

    # {week_num: {game_date: [team, ...]}} — normalize team keys
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

    player_results = []
    for p in body.players:
        player_results.append(SimulatePlayerResult(
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
        ))

    return SimulateScheduleResponse(players=player_results)


@app.get("/player-grid", response_model=list[PlayerGridRow], tags=["data"])
async def get_player_grid(db: AsyncSession = Depends(get_db)):
    """
    Player × day grid for all 21 playoff days.
    Each row shows: which days a player has a game, whether they're starting
    that day (per daily optimizer), raw game totals, and playable (startable)
    totals per week.
    """
    calendar = await _build_daily_lineups(db)
    if not calendar:
        raise HTTPException(
            status_code=404,
            detail="No schedule data found. Run /ingest/all first.",
        )

    # Build a set of (player_name, date_str) → is_starting
    starting_map: dict[tuple[str, str], bool] = {}
    for week_cal in calendar:
        for day in week_cal.days:
            for slot in day.lineup:
                if slot.player:
                    starting_map[(slot.player, day.date)] = True
            for benched in day.benched:
                starting_map[(benched, day.date)] = False

    # Collect all days in order
    all_days: list[tuple[str, str, int]] = []  # (date_str, label, week_num)
    for week_cal in calendar:
        for day in week_cal.days:
            all_days.append((day.date, day.day_label, week_cal.week_num))

    # Load roster players (IL excluded — they don't count in the grid)
    player_rows = (
        await db.execute(select(Player).where(Player.is_active == True, Player.is_il == False))
    ).scalars().all()

    # Build set of dates each roster team plays (expand + normalize for abbreviation variants)
    roster_teams_for_grid = {normalize_team_abbr(p.team) for p in player_rows} or {normalize_team_abbr(p["team"]) for p in ROSTER}
    gd_rows = (
        await db.execute(
            select(GameDay)
            .where(GameDay.team.in_(expand_team_set(roster_teams_for_grid)))
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
