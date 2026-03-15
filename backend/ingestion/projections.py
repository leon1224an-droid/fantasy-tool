"""
Pulls season-average per-game stats from the NBA Stats API, applies fantasy
scoring weights, and upserts PlayerProjection rows for all 3 playoff weeks.

The player list is now DB-driven: ingest_projections reads active Player rows
so adding/removing players via the roster API is automatically reflected.
The hardcoded ROSTER is only used for the initial seed (empty DB).
"""

import asyncio
import os
from typing import Any

from nba_api.stats.endpoints import leaguedashplayerstats
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Player, PlayerProjection, TeamSchedule
from .schedule import expand_team_set, normalize_team_abbr

# ---------------------------------------------------------------------------
# Initial roster seed (used only when the players table is empty)
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
# Fantasy scoring weights
# ---------------------------------------------------------------------------
SCORING: dict[str, float] = {
    "pts": 1.0,
    "reb": 1.2,
    "ast": 1.5,
    "stl": 3.0,
    "blk": 3.0,
    "tov": -1.0,
    "tpm": 1.0,
}

# ---------------------------------------------------------------------------
# NBA position → fantasy position mapping
# ---------------------------------------------------------------------------
_NBA_POS_MAP: dict[str, list[str]] = {
    "G":              ["PG", "SG"],
    "F":              ["SF", "PF"],
    "C":              ["C"],
    "G-F":            ["SG", "SF"],
    "F-G":            ["SG", "SF"],
    "F-C":            ["PF", "C"],
    "C-F":            ["PF", "C"],
    "Guard":          ["PG", "SG"],
    "Forward":        ["SF", "PF"],
    "Center":         ["C"],
    "Guard-Forward":  ["SG", "SF"],
    "Forward-Guard":  ["SG", "SF"],
    "Forward-Center": ["PF", "C"],
    "Center-Forward": ["PF", "C"],
}


def map_nba_position(nba_pos: str) -> list[str]:
    """Map an NBA API position string to fantasy-league positions."""
    return _NBA_POS_MAP.get(nba_pos, ["SF", "PF"])


# ---------------------------------------------------------------------------
# Stats helpers
# ---------------------------------------------------------------------------
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


async def fetch_nba_player_stats(season: str | None = None) -> dict[str, dict[str, float]]:
    """Returns {player_name: {pts, reb, ast, stl, blk, tov, tpm, fg_pct, ft_pct, fg_att_pg, ft_att_pg}}."""
    season = season or os.getenv("NBA_SEASON", "2025-26")

    def _fetch() -> dict[str, dict[str, float]]:
        endpoint = leaguedashplayerstats.LeagueDashPlayerStats(
            season=season,
            per_mode_detailed="PerGame",
            timeout=60,
        )
        df = endpoint.get_data_frames()[0]
        result: dict[str, dict[str, float]] = {}
        for _, row in df.iterrows():
            result[row["PLAYER_NAME"]] = {
                "pts":       float(row.get("PTS")    or 0),
                "reb":       float(row.get("REB")    or 0),
                "ast":       float(row.get("AST")    or 0),
                "stl":       float(row.get("STL")    or 0),
                "blk":       float(row.get("BLK")    or 0),
                "tov":       float(row.get("TOV")    or 0),
                "tpm":       float(row.get("FG3M")   or 0),
                "fg_pct":    float(row.get("FG_PCT") or 0),
                "ft_pct":    float(row.get("FT_PCT") or 0),
                "fg_att_pg": float(row.get("FGA")    or 0),
                "ft_att_pg": float(row.get("FTA")    or 0),
            }
        return result

    return await asyncio.get_event_loop().run_in_executor(None, _fetch)


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------
async def ingest_player_directory(db: AsyncSession, season: str | None = None) -> int:
    """Fetch all active NBA players (team + position) from PlayerIndex and upsert into
    the players table as inactive rows.  This ensures that any active NBA player can
    be found by the DB-first /players/info lookup, not just Yahoo-rostered ones.

    Only updates `team` and `positions` on conflict — does NOT touch is_active / is_il
    so existing roster state is preserved.
    """
    from nba_api.stats.endpoints import playerindex as pi_module

    season = season or os.getenv("NBA_SEASON", "2025-26")

    def _fetch() -> list[dict]:
        endpoint = pi_module.PlayerIndex(season=season, timeout=30)
        df = endpoint.get_data_frames()[0]
        rows = []
        for _, row in df.iterrows():
            first = str(row.get("PLAYER_FIRST_NAME") or "").strip()
            last  = str(row.get("PLAYER_LAST_NAME")  or "").strip()
            name  = f"{first} {last}".strip()
            team  = str(row.get("TEAM_ABBREVIATION") or "").upper().strip()
            pos   = str(row.get("POSITION")          or "").strip()
            if not name or not team:
                continue
            rows.append({"name": name, "team": team, "position": pos})
        return rows

    try:
        players = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _fetch),
            timeout=25,
        )
    except Exception as exc:
        print(f"[player_directory] WARNING — failed to fetch: {exc}")
        return 0

    count = 0
    for p in players:
        positions = map_nba_position(p["position"])
        stmt = (
            insert(Player)
            .values(name=p["name"], team=p["team"], positions=positions, is_active=False, is_il=False)
            .on_conflict_do_update(
                constraint="uq_players_name",
                set_={"team": p["team"], "positions": positions},
            )
        )
        await db.execute(stmt)
        count += 1

    await db.commit()
    print(f"[player_directory] Upserted {count} active NBA players.")
    return count


async def seed_players(db: AsyncSession) -> None:
    """Upsert initial ROSTER players (only called when players table is empty)."""
    for p in ROSTER:
        stmt = (
            insert(Player)
            .values(name=p["name"], team=p["team"], positions=p["positions"], is_active=True)
            .on_conflict_do_update(
                constraint="uq_players_name",
                set_={"team": p["team"], "positions": p["positions"], "is_active": True},
            )
        )
        await db.execute(stmt)
    await db.commit()


# ---------------------------------------------------------------------------
# Main ingestion pipeline
# ---------------------------------------------------------------------------
async def ingest_projections(
    db: AsyncSession,
    season: str | None = None,
    players: list | None = None,
) -> None:
    """
    1. If no active players exist yet, seed from hardcoded ROSTER.
    2. Fetch season averages from NBA Stats API for ALL league players.
    3. Upsert PlayerProjection (source='nba_api') for each player × 3 playoff weeks.

    If `players` is provided, use that list instead of querying active players.
    This lets the Yahoo ingest pre-populate projections for all rostered players.
    """
    if players is not None:
        active_players = players
    else:
        # Seed on first run
        active_count: int = (
            await db.execute(select(func.count(Player.id)).where(Player.is_active == True))
        ).scalar_one()
        if active_count == 0:
            await seed_players(db)

        # Load all active roster players from DB
        active_players = (
            await db.execute(select(Player).where(Player.is_active == True))
        ).scalars().all()

    # Fetch NBA stats for the whole league
    nba_stats = await fetch_nba_player_stats(season)

    # Build games_lookup from TeamSchedule
    # Expand team set to cover both canonical ("WAS") and legacy ("WSH") variants
    roster_teams = {p.team for p in active_players}
    schedule_rows = (
        await db.execute(
            select(TeamSchedule).where(TeamSchedule.team.in_(expand_team_set(roster_teams)))
        )
    ).scalars().all()
    # Normalize keys so "WSH" and "WAS" both map to the same entry
    games_lookup: dict[tuple[str, int], int] = {
        (normalize_team_abbr(row.team), row.week_num): row.games_count for row in schedule_rows
    }

    missing: list[str] = []
    for player in active_players:
        stats = nba_stats.get(player.name)
        if not stats:
            missing.append(player.name)
            continue

        fantasy_ppg = round(compute_fantasy_ppg(stats), 3)

        for week_num in (21, 22, 23):
            games = games_lookup.get((normalize_team_abbr(player.team), week_num), 0)
            projected_total = round(fantasy_ppg * games, 2)

            stmt = (
                insert(PlayerProjection)
                .values(
                    player_id=player.id,
                    week_num=week_num,
                    source="nba_api",
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
                    fg_att_pg=stats["fg_att_pg"],
                    ft_att_pg=stats["ft_att_pg"],
                    fantasy_ppg=fantasy_ppg,
                    projected_total=projected_total,
                )
                .on_conflict_do_update(
                    constraint="uq_projection_player_week_source",
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
                        "fg_att_pg": stats["fg_att_pg"],
                        "ft_att_pg": stats["ft_att_pg"],
                        "fantasy_ppg": fantasy_ppg,
                        "projected_total": projected_total,
                    },
                )
            )
            await db.execute(stmt)

    await db.commit()

    if missing:
        print(f"[projections] WARNING — no NBA stats found for: {', '.join(missing)}")
    total = len(active_players)
    print(f"[projections] Ingested {total - len(missing)}/{total} players × 3 weeks.")
