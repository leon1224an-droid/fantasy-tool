"""
League-wide endpoints:
  GET /league/teams                           — list all Yahoo league teams + rosters
  GET /league/rankings?week=21                — projected category-win rankings
  GET /league/matchup?team_a=X&team_b=Y&week=21  — head-to-head breakdown
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..ingestion.yahoo import fetch_yahoo_matchups
from ..models import YahooLeagueTeam
from ..optimizer.league import (
    CategoryResult,
    MatchupResult,
    TeamProjection,
    compute_league_rankings,
    compute_team_projections,
    project_matchup,
)

router = APIRouter(prefix="/league", tags=["league"])


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class RosterEntry(BaseModel):
    name: str
    team: str
    positions: list[str]
    is_il: bool = False


class LeagueTeamResponse(BaseModel):
    team_key: str
    team_name: str
    manager_name: str | None
    roster: list[RosterEntry]
    fetched_at: str


class TeamRankingResponse(BaseModel):
    rank: int
    team_key: str
    team_name: str
    proj_wins: int
    total_games: int
    pts: float
    reb: float
    ast: float
    stl: float
    blk: float
    tov: float
    tpm: float
    fg_pct: float
    ft_pct: float


class CategoryResultResponse(BaseModel):
    category: str
    a_value: float
    b_value: float
    winner: str
    margin: float


class MatchupResponse(BaseModel):
    team_a: str
    team_b: str
    week_num: int
    categories: list[CategoryResultResponse]
    a_wins: int
    b_wins: int
    ties: int
    a_games: int
    b_games: int


class ScheduledMatchupResponse(BaseModel):
    team_a_key: str
    team_a_name: str
    team_b_key: str
    team_b_name: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/teams", response_model=list[LeagueTeamResponse])
async def get_league_teams(db: AsyncSession = Depends(get_db)):
    """Return all Yahoo league teams with their rosters."""
    teams = (
        await db.execute(select(YahooLeagueTeam).order_by(YahooLeagueTeam.team_name))
    ).scalars().all()

    result = []
    for t in teams:
        roster_entries = []
        for entry in (t.roster or []):
            if isinstance(entry, dict):
                roster_entries.append(RosterEntry(
                    name=entry.get("name", ""),
                    team=entry.get("team", ""),
                    positions=entry.get("positions", []),
                    is_il=entry.get("is_il", False),
                ))
        result.append(LeagueTeamResponse(
            team_key=t.team_key,
            team_name=t.team_name,
            manager_name=t.manager_name,
            roster=roster_entries,
            fetched_at=t.fetched_at.isoformat(),
        ))

    return result


@router.get("/rankings", response_model=list[TeamRankingResponse])
async def get_league_rankings(
    week: int = Query(default=21, ge=21, le=23),
    db: AsyncSession = Depends(get_db),
):
    """
    Rank all Yahoo league teams by projected category wins for the given week.
    Each team is simulated against every other team; category win totals determine rank.
    """
    rankings = await compute_league_rankings(db, week)
    if not rankings:
        raise HTTPException(
            status_code=404,
            detail="No league team data found. Run POST /ingest/yahoo-league first.",
        )

    return [
        TeamRankingResponse(
            rank=r["rank"],
            team_key=r["team_key"],
            team_name=r["team_name"],
            proj_wins=r["proj_wins"],
            total_games=r.get("total_games", 0),
            pts=r.get("pts", 0.0),
            reb=r.get("reb", 0.0),
            ast=r.get("ast", 0.0),
            stl=r.get("stl", 0.0),
            blk=r.get("blk", 0.0),
            tov=r.get("tov", 0.0),
            tpm=r.get("tpm", 0.0),
            fg_pct=r.get("fg_pct", 0.0),
            ft_pct=r.get("ft_pct", 0.0),
        )
        for r in rankings
    ]


@router.get("/matchups", response_model=list[ScheduledMatchupResponse])
async def get_league_matchups(
    week: int = Query(..., ge=1, description="Yahoo fantasy week number"),
):
    """
    Fetch the live Yahoo Fantasy matchup schedule for a given week.
    Uses Yahoo's own week numbering (1-based from season start).
    Requires Yahoo credentials in env vars.
    """
    matchups = await fetch_yahoo_matchups(week)
    return [ScheduledMatchupResponse(**m) for m in matchups]


@router.get("/matchup", response_model=MatchupResponse)
async def get_matchup(
    team_a: str = Query(..., description="team_key of team A"),
    team_b: str = Query(..., description="team_key of team B"),
    week: int = Query(default=21, ge=21, le=23),
    exclude_a: str = Query(default="", description="Comma-separated player names to IL for team A"),
    exclude_b: str = Query(default="", description="Comma-separated player names to IL for team B"),
    db: AsyncSession = Depends(get_db),
):
    """Head-to-head category breakdown between two teams for a given week."""
    exclude: dict[str, set[str]] = {}
    if exclude_a:
        exclude[team_a] = set(n.strip() for n in exclude_a.split(",") if n.strip())
    if exclude_b:
        exclude[team_b] = set(n.strip() for n in exclude_b.split(",") if n.strip())

    projections = await compute_team_projections(db, week, exclude=exclude)

    proj_map: dict[str, TeamProjection] = {p.team_key: p for p in projections}

    a_proj = proj_map.get(team_a)
    b_proj = proj_map.get(team_b)

    if not a_proj:
        raise HTTPException(status_code=404, detail=f"Team '{team_a}' not found.")
    if not b_proj:
        raise HTTPException(status_code=404, detail=f"Team '{team_b}' not found.")

    result = project_matchup(a_proj, b_proj)

    return MatchupResponse(
        team_a=result.team_a,
        team_b=result.team_b,
        week_num=result.week_num,
        categories=[
            CategoryResultResponse(
                category=c.category,
                a_value=c.a_value,
                b_value=c.b_value,
                winner=c.winner,
                margin=c.margin,
            )
            for c in result.categories
        ],
        a_wins=result.a_wins,
        b_wins=result.b_wins,
        ties=result.ties,
        a_games=result.a_games,
        b_games=result.b_games,
    )
