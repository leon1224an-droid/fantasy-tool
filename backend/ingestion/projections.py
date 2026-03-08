"""
Pulls season-average per-game stats from the NBA Stats API, applies fantasy
scoring weights, and upserts PlayerProjection rows for all 3 playoff weeks.

Fantasy scoring weights below match a common H2H Points league.
Edit SCORING to match your actual league settings.
"""

import os
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Player, PlayerProjection, TeamSchedule

# ---------------------------------------------------------------------------
# Roster (single source of truth — mirrors CLAUDE.md)
# ---------------------------------------------------------------------------
ROSTER: list[dict[str, Any]] = [
    {"name": "James Harden",            "team": "CLE", "positions": ["PG", "SG"]},
    {"name": "Kevin Durant",             "team": "HOU", "positions": ["SG", "SF", "PF"]},
    {"name": "Noah Clowney",             "team": "BKN", "positions": ["PF", "C"]},
    {"name": "Nickeil Alexander-Walker", "team": "ATL", "positions": ["PG", "SG", "SF"]},
    {"name": "De'Aaron Fox",             "team": "SAS", "positions": ["PG", "SG"]},
    {"name": "Darius Garland",           "team": "LAC", "positions": ["PG"]},
    {"name": "Jalen Suggs",              "team": "ORL", "positions": ["PG", "SG"]},
    {"name": "Christian Braun",          "team": "DEN", "positions": ["SG", "SF"]},
    {"name": "Immanuel Quickley",        "team": "TOR", "positions": ["PG", "SG"]},
    {"name": "Nique Clifford",           "team": "SAC", "positions": ["SG", "SF"]},
    {"name": "Austin Reaves",            "team": "LAL", "positions": ["PG", "SG", "SF"]},
    {"name": "Cooper Flagg",             "team": "DAL", "positions": ["PG", "SG", "SF"]},
    {"name": "Toumani Camara",           "team": "POR", "positions": ["SF", "PF", "C"]},
]

# ---------------------------------------------------------------------------
# Fantasy scoring weights — adjust to match your league
# ---------------------------------------------------------------------------
SCORING: dict[str, float] = {
    "pts": 1.0,
    "reb": 1.2,
    "ast": 1.5,
    "stl": 3.0,
    "blk": 3.0,
    "tov": -1.0,
    "tpm": 1.0,   # 3-pointers made
}

# ---------------------------------------------------------------------------
# NBA Stats API
# ---------------------------------------------------------------------------
NBA_STATS_URL = "https://stats.nba.com/stats/leaguedashplayerstats"
NBA_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.nba.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}
NBA_PARAMS = {
    "MeasureType": "Base",
    "PerMode": "PerGame",
    "PlusMinus": "N",
    "PaceAdjust": "N",
    "Rank": "N",
    "LeagueID": "00",
    "SeasonType": "Regular Season",
    "PlayerOrTeam": "Player",
    "Outcome": "",
    "Location": "",
    "Month": "0",
    "SeasonSegment": "",
    "DateFrom": "",
    "DateTo": "",
    "OpponentTeamID": "0",
    "VsConference": "",
    "VsDivision": "",
    "GameSegment": "",
    "Period": "0",
    "ShotClockRange": "",
    "LastNGames": "0",
    "GameScope": "",
    "PlayerExperience": "",
    "PlayerPosition": "",
    "StarterBench": "",
    "TwoWay": "0",
}


def compute_fantasy_ppg(stats: dict[str, float]) -> float:
    return (
        stats["pts"] * SCORING["pts"]
        + stats["reb"] * SCORING["reb"]
        + stats["ast"] * SCORING["ast"]
        + stats["stl"] * SCORING["stl"]
        + stats["blk"] * SCORING["blk"]
        + stats["tov"] * SCORING["tov"]
        + stats["tpm"] * SCORING["tpm"]
    )


async def fetch_nba_player_stats(
    season: str | None = None,
) -> dict[str, dict[str, float]]:
    """
    Returns {player_name: {pts, reb, ast, stl, blk, tov, tpm, fg_pct, ft_pct}}
    using NBA season-average per-game stats.
    """
    season = season or os.getenv("NBA_SEASON", "2025-26")
    params = {**NBA_PARAMS, "Season": season}

    async with httpx.AsyncClient(timeout=30, headers=NBA_HEADERS) as client:
        resp = await client.get(NBA_STATS_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    result_set = data["resultSets"][0]
    headers: list[str] = result_set["headers"]
    rows: list[list] = result_set["rowSet"]

    stats_by_name: dict[str, dict[str, float]] = {}
    for row in rows:
        r = dict(zip(headers, row))
        stats_by_name[r["PLAYER_NAME"]] = {
            "pts":    float(r.get("PTS")    or 0),
            "reb":    float(r.get("REB")    or 0),
            "ast":    float(r.get("AST")    or 0),
            "stl":    float(r.get("STL")    or 0),
            "blk":    float(r.get("BLK")    or 0),
            "tov":    float(r.get("TOV")    or 0),
            "tpm":    float(r.get("FG3M")   or 0),
            "fg_pct": float(r.get("FG_PCT") or 0),
            "ft_pct": float(r.get("FT_PCT") or 0),
        }
    return stats_by_name


async def seed_players(db: AsyncSession) -> dict[str, int]:
    """
    Upsert all roster players and return a {name: player_id} mapping.
    """
    name_to_id: dict[str, int] = {}
    for p in ROSTER:
        stmt = (
            insert(Player)
            .values(name=p["name"], team=p["team"], positions=p["positions"], is_active=True)
            .on_conflict_do_update(
                constraint="uq_players_name",
                set_={"team": p["team"], "positions": p["positions"], "is_active": True},
            )
            .returning(Player.id)
        )
        result = await db.execute(stmt)
        name_to_id[p["name"]] = result.scalar_one()
    await db.commit()
    return name_to_id


async def ingest_projections(
    db: AsyncSession,
    season: str | None = None,
) -> None:
    """
    Full pipeline:
      1. Seed / update players in DB
      2. Fetch season averages from NBA Stats API
      3. Upsert PlayerProjection for each player × each of the 3 playoff weeks
    Requires TeamSchedule rows to already exist (run ingest_schedule first).
    """
    name_to_id = await seed_players(db)
    nba_stats = await fetch_nba_player_stats(season)

    # Load game counts for all roster teams
    roster_teams = {p["team"] for p in ROSTER}
    schedule_rows = (
        await db.execute(
            select(TeamSchedule).where(TeamSchedule.team.in_(roster_teams))
        )
    ).scalars().all()
    games_lookup: dict[tuple[str, int], int] = {
        (row.team, row.week_num): row.games_count for row in schedule_rows
    }

    missing: list[str] = []
    for player in ROSTER:
        player_id = name_to_id[player["name"]]
        stats = nba_stats.get(player["name"])
        if not stats:
            missing.append(player["name"])
            continue

        fantasy_ppg = round(compute_fantasy_ppg(stats), 3)

        for week_num in (21, 22, 23):
            games = games_lookup.get((player["team"], week_num), 0)
            projected_total = round(fantasy_ppg * games, 2)

            stmt = (
                insert(PlayerProjection)
                .values(
                    player_id=player_id,
                    week_num=week_num,
                    games_count=games,
                    pts_pg=stats["pts"],
                    reb_pg=stats["reb"],
                    ast_pg=stats["ast"],
                    stl_pg=stats["stl"],
                    blk_pg=stats["blk"],
                    tov_pg=stats["tov"],
                    tpm_pg=stats["tpm"],
                    fg_pct=stats["fg_pct"],
                    ft_pct=stats["ft_pct"],
                    fantasy_ppg=fantasy_ppg,
                    projected_total=projected_total,
                )
                .on_conflict_do_update(
                    constraint="uq_projection_player_week",
                    set_={
                        "games_count": games,
                        "pts_pg": stats["pts"],
                        "reb_pg": stats["reb"],
                        "ast_pg": stats["ast"],
                        "stl_pg": stats["stl"],
                        "blk_pg": stats["blk"],
                        "tov_pg": stats["tov"],
                        "tpm_pg": stats["tpm"],
                        "fg_pct": stats["fg_pct"],
                        "ft_pct": stats["ft_pct"],
                        "fantasy_ppg": fantasy_ppg,
                        "projected_total": projected_total,
                    },
                )
            )
            await db.execute(stmt)

    await db.commit()

    if missing:
        print(f"[projections] WARNING — no NBA stats found for: {', '.join(missing)}")
    print(
        f"[projections] Ingested projections for "
        f"{len(ROSTER) - len(missing)}/{len(ROSTER)} players × 3 weeks."
    )
