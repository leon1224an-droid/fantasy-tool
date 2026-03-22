"""
Fetches the NBA game schedule for the 3 playoff weeks by querying the ESPN
public scoreboard API one day at a time, then upserts TeamSchedule and
GameDay rows.

ESPN scoreboard endpoint (no auth required):
  GET https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
  ?dates=YYYYMMDD
"""

import asyncio
from collections import defaultdict
from datetime import date, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import GameDay, TeamSchedule

# ---------------------------------------------------------------------------
# Playoff week definitions
# ---------------------------------------------------------------------------
PLAYOFF_WEEKS: list[dict] = [
    {"week": 21, "start": date(2026, 3, 16), "end": date(2026, 3, 22)},
    {"week": 22, "start": date(2026, 3, 23), "end": date(2026, 3, 29)},
    {"week": 23, "start": date(2026, 3, 30), "end": date(2026, 4, 5)},
]

ESPN_SCOREBOARD_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
)

# ESPN sometimes uses shorter codes; normalise to standard 2-3 letter tricodes
ESPN_ABBR_MAP: dict[str, str] = {
    "SA":   "SAS",
    "GS":   "GSW",
    "NO":   "NOP",
    "NY":   "NYK",
    "PHX":  "PHX",
    "UTAH": "UTA",
    "WSH":  "WAS",   # Washington Wizards (ESPN uses WSH, NBA standard is WAS)
    "PHO":  "PHX",   # Phoenix alternate
    "NJN":  "BKN",   # Old Nets abbreviation
    "NOH":  "NOP",
    "NOK":  "NOP",
    "SEA":  "OKC",
}

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def normalize_team_abbr(abbr: str) -> str:
    """Normalize any known ESPN/legacy team abbreviation to the standard NBA form."""
    return ESPN_ABBR_MAP.get(abbr.upper(), abbr.upper())


def expand_team_set(teams: set[str]) -> set[str]:
    """
    Return an expanded set that includes both canonical and legacy variants.
    Use this when building SQL `team.in_(...)` clauses so queries work against
    both old (pre-normalization) and new DB rows.
    """
    expanded = set(teams)
    for variant, canonical in ESPN_ABBR_MAP.items():
        if canonical in teams:
            expanded.add(variant)
    return expanded


def _normalise(abbr: str) -> str:
    return normalize_team_abbr(abbr)


def _day_label(d: date) -> str:
    """Return a short label like 'Mon 3/16'."""
    dow = DAY_NAMES[d.weekday()]
    return f"{dow} {d.month}/{d.day}"


async def _games_on_date(client: httpx.AsyncClient, d: date) -> list[str]:
    """Return list of team tricodes (both home and away) with games on date d."""
    resp = await client.get(
        ESPN_SCOREBOARD_URL,
        params={"dates": d.strftime("%Y%m%d")},
    )
    resp.raise_for_status()
    data = resp.json()

    teams: list[str] = []
    for event in data.get("events", []):
        for competition in event.get("competitions", []):
            for competitor in competition.get("competitors", []):
                raw = competitor.get("team", {}).get("abbreviation", "")
                if raw:
                    teams.append(_normalise(raw))
    return teams


async def fetch_schedule() -> tuple[dict[int, dict[str, int]], dict[int, dict[date, list[str]]]]:
    """
    Returns:
      - week_counts:  {week_num: {team: games_count}}
      - week_days:    {week_num: {game_date: [team, ...]}}
    Makes one HTTP request per day (21 total).
    """
    week_counts: dict[int, dict[str, int]] = {}
    week_days: dict[int, dict[date, list[str]]] = {}

    # Collect all (week, date) pairs upfront, then fetch all 21 days concurrently
    all_pairs: list[tuple[dict, date]] = []
    for week in PLAYOFF_WEEKS:
        d = week["start"]
        while d <= week["end"]:
            all_pairs.append((week, d))
            d += timedelta(days=1)

    async with httpx.AsyncClient(timeout=20) as client:
        results = await asyncio.gather(
            *[_games_on_date(client, d) for _, d in all_pairs]
        )

    for (week, d), teams in zip(all_pairs, results):
        wn = week["week"]
        week_days.setdefault(wn, {})[d] = teams
        counts = week_counts.setdefault(wn, defaultdict(int))
        for team in teams:
            counts[team] += 1

    week_counts = {wn: dict(c) for wn, c in week_counts.items()}
    return week_counts, week_days


async def ingest_schedule(db: AsyncSession, force: bool = False) -> dict[int, dict[str, int]]:
    """
    Fetch the NBA schedule and upsert TeamSchedule + GameDay rows.
    Returns the raw {week_num: {team: games_count}} dict for inspection.

    If force=False (default) and the schedule table already has rows, skip the
    ESPN API call and return the existing data from the DB — the NBA schedule
    for a fixed date range never changes after the games are played.
    """
    if not force:
        existing = (await db.execute(select(TeamSchedule))).scalars().all()
        if existing:
            print("[schedule] Already ingested — returning cached data (pass force=True to re-fetch).")
            result: dict[int, dict[str, int]] = {}
            for row in existing:
                result.setdefault(row.week_num, {})[row.team] = row.games_count
            return result

    week_counts, week_days = await fetch_schedule()
    week_meta = {w["week"]: w for w in PLAYOFF_WEEKS}

    # Upsert TeamSchedule (weekly game counts)
    for week_num, team_games in week_counts.items():
        meta = week_meta[week_num]
        for team, games_count in team_games.items():
            stmt = (
                insert(TeamSchedule)
                .values(
                    team=team,
                    week_num=week_num,
                    week_start=meta["start"],
                    week_end=meta["end"],
                    games_count=games_count,
                )
                .on_conflict_do_update(
                    constraint="uq_team_schedule_team_week",
                    set_={"games_count": games_count},
                )
            )
            await db.execute(stmt)

    # Upsert GameDay (individual game dates per team)
    game_day_count = 0
    for week_num, days in week_days.items():
        for game_date, teams in days.items():
            label = _day_label(game_date)
            for team in teams:
                stmt = (
                    insert(GameDay)
                    .values(
                        team=team,
                        week_num=week_num,
                        game_date=game_date,
                        day_label=label,
                    )
                    .on_conflict_do_update(
                        constraint="uq_game_day_team_date",
                        set_={"week_num": week_num, "day_label": label},
                    )
                )
                await db.execute(stmt)
                game_day_count += 1

    await db.commit()
    total_pairs = sum(len(v) for v in week_counts.values())
    print(f"[schedule] Ingested {total_pairs} team-week pairs, {game_day_count} game-day rows.")
    return week_counts
