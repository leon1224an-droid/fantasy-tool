"""
Fetches the NBA game schedule for the 3 playoff weeks by querying the ESPN
public scoreboard API one day at a time, then upserts TeamSchedule rows.

ESPN scoreboard endpoint (no auth required):
  GET https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
  ?dates=YYYYMMDD
"""

from collections import defaultdict
from datetime import date, timedelta

import httpx
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TeamSchedule

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
    "SA":  "SAS",
    "GS":  "GSW",
    "NO":  "NOP",
    "NY":  "NYK",
    "PHX": "PHX",
    "UTAH": "UTA",
}


def _normalise(abbr: str) -> str:
    return ESPN_ABBR_MAP.get(abbr.upper(), abbr.upper())


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


async def fetch_schedule() -> dict[int, dict[str, int]]:
    """
    Returns {week_num: {team_tricode: games_count}} for all 3 playoff weeks.
    Makes one HTTP request per day (21 total requests).
    """
    results: dict[int, dict[str, int]] = {}

    async with httpx.AsyncClient(timeout=20) as client:
        for week in PLAYOFF_WEEKS:
            counts: dict[str, int] = defaultdict(int)
            d = week["start"]
            while d <= week["end"]:
                teams = await _games_on_date(client, d)
                for team in teams:
                    counts[team] += 1
                d += timedelta(days=1)
            results[week["week"]] = dict(counts)

    return results


async def ingest_schedule(db: AsyncSession) -> dict[int, dict[str, int]]:
    """
    Fetch the NBA schedule and upsert TeamSchedule rows for all 3 playoff weeks.
    Returns the raw {week_num: {team: games}} dict for inspection.
    """
    schedule = await fetch_schedule()
    week_meta = {w["week"]: w for w in PLAYOFF_WEEKS}

    for week_num, team_games in schedule.items():
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

    await db.commit()
    total_pairs = sum(len(v) for v in schedule.values())
    print(f"[schedule] Ingested {total_pairs} team-week pairs.")
    return schedule
