"""
Yahoo Fantasy Sports integration via yfpy.

Required environment variables:
  YAHOO_CLIENT_ID       — OAuth consumer key
  YAHOO_CLIENT_SECRET   — OAuth consumer secret
  YAHOO_REFRESH_TOKEN   — OAuth refresh token (obtain via Yahoo OAuth flow)
  YAHOO_LEAGUE_ID       — League ID (numeric, visible in league URL)

yfpy docs: https://yfpy.uberfastman.com/
"""

import asyncio
import json
import os
import tempfile
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Player, PlayerProjection, TeamSchedule, YahooLeagueTeam
from .projections import SCORING, compute_fantasy_ppg, map_nba_position


# ---------------------------------------------------------------------------
# yfpy query builder
# ---------------------------------------------------------------------------

def _build_yahoo_query() -> tuple[Any, str]:
    """
    Build a yfpy YahooFantasySportsQuery from environment variables.
    Raises HTTPException(400) if any required credential is missing.
    """
    client_id = os.getenv("YAHOO_CLIENT_ID")
    client_secret = os.getenv("YAHOO_CLIENT_SECRET")
    refresh_token = os.getenv("YAHOO_REFRESH_TOKEN")
    league_id = os.getenv("YAHOO_LEAGUE_ID")

    missing = [
        name for name, val in [
            ("YAHOO_CLIENT_ID", client_id),
            ("YAHOO_CLIENT_SECRET", client_secret),
            ("YAHOO_REFRESH_TOKEN", refresh_token),
            ("YAHOO_LEAGUE_ID", league_id),
        ] if not val
    ]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Yahoo credentials not configured. Missing env vars: {', '.join(missing)}",
        )

    try:
        from yfpy import YahooFantasySportsQuery  # noqa: PLC0415
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="yfpy is not installed. Run: pip install 'yfpy>=11.0.0'",
        ) from exc

    # Write OAuth credentials to a temp dir that yfpy can use
    tmp_dir = tempfile.mkdtemp()
    private_json = {"consumer_key": client_id, "consumer_secret": client_secret}
    with open(os.path.join(tmp_dir, "private.json"), "w") as fh:
        json.dump(private_json, fh)

    # Write refresh token so yfpy can skip the browser auth step
    token_data = {
        "access_token": "",
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "token_time": datetime.now(timezone.utc).timestamp(),
        "token_url": "https://api.login.yahoo.com/oauth2/get_token",
    }
    with open(os.path.join(tmp_dir, "token.json"), "w") as fh:
        json.dump(token_data, fh)

    query = YahooFantasySportsQuery(
        league_id=league_id,
        game_code="nba",
        yahoo_consumer_key=client_id,
        yahoo_consumer_secret=client_secret,
        env_file_location=tmp_dir,
        save_token_data_to_env_file=True,
    )
    return query, league_id


# ---------------------------------------------------------------------------
# Helpers for parsing yfpy player objects
# ---------------------------------------------------------------------------

def _extract_player_name(player_obj: Any) -> str | None:
    """Extract player name from various yfpy player object shapes."""
    # yfpy objects expose attributes or dict keys depending on version
    for attr in ("full_name", "name", "player_name"):
        val = getattr(player_obj, attr, None)
        if val:
            return str(val)
    if isinstance(player_obj, dict):
        for key in ("full_name", "name", "player_name"):
            if player_obj.get(key):
                return str(player_obj[key])
    return None


def _extract_player_team(player_obj: Any) -> str:
    for attr in ("editorial_team_abbr", "team_abbr", "team"):
        val = getattr(player_obj, attr, None)
        if val:
            return str(val).upper()
    if isinstance(player_obj, dict):
        for key in ("editorial_team_abbr", "team_abbr", "team"):
            if player_obj.get(key):
                return str(player_obj[key]).upper()
    return "UNK"


def _extract_player_positions(player_obj: Any) -> list[str]:
    for attr in ("eligible_positions", "display_position", "position_type"):
        val = getattr(player_obj, attr, None)
        if val:
            raw = str(val)
            parts = [p.strip().upper() for p in raw.replace(",", "/").split("/")]
            positions = set()
            for p in parts:
                if p in ("PG", "SG", "SF", "PF", "C"):
                    positions.add(p)
                else:
                    positions.update(map_nba_position(p.title()))
            if positions:
                return sorted(positions)
    return ["SF", "PF"]


def _extract_stat(stats_obj: Any, stat_id: str, fallback_key: str) -> float:
    """Try to extract a stat value from yfpy stats object."""
    # yfpy stats come as a list of {stat_id, value} or as a dict
    if hasattr(stats_obj, "stats"):
        stat_list = stats_obj.stats
        if isinstance(stat_list, list):
            for s in stat_list:
                sid = getattr(s, "stat_id", None) or (s.get("stat_id") if isinstance(s, dict) else None)
                if str(sid) == str(stat_id):
                    val = getattr(s, "value", None) or (s.get("value") if isinstance(s, dict) else None)
                    try:
                        return float(val or 0)
                    except (ValueError, TypeError):
                        return 0.0
    # Try direct attribute
    val = getattr(stats_obj, fallback_key, None)
    if val is not None:
        try:
            return float(val)
        except (ValueError, TypeError):
            pass
    return 0.0


# Yahoo NBA stat IDs (standard fantasy basketball)
_YAHOO_STAT_IDS = {
    "pts":    "12",
    "reb":    "15",
    "ast":    "13",
    "stl":    "16",
    "blk":    "17",
    "tov":    "18",
    "tpm":    "10",
    "fg_pct": "5",
    "ft_pct": "8",
    "fg_att_pg": "4",  # FGA
    "ft_att_pg": "7",  # FTA
}


# ---------------------------------------------------------------------------
# Main ingestion pipeline
# ---------------------------------------------------------------------------

async def ingest_yahoo_league(db: AsyncSession) -> dict:
    """
    Fetch all teams, rosters, and per-game stat projections from Yahoo Fantasy.
    Upserts Player, PlayerProjection (source='yahoo'), and YahooLeagueTeam rows.
    """
    def _sync_fetch():
        query, league_id = _build_yahoo_query()

        # Fetch all teams
        teams = query.get_league_teams()
        if not teams:
            return []

        results = []
        for team in teams:
            team_id = getattr(team, "team_id", None) or (team.get("team_id") if isinstance(team, dict) else None)
            team_name = getattr(team, "name", None) or (team.get("name") if isinstance(team, dict) else f"Team {team_id}")
            team_key = getattr(team, "team_key", None) or (team.get("team_key") if isinstance(team, dict) else f"{league_id}.t.{team_id}")

            manager_name = None
            managers = getattr(team, "managers", None)
            if managers and len(managers) > 0:
                first = managers[0]
                manager_name = getattr(first, "nickname", None) or getattr(first, "name", None)

            # Get roster
            try:
                roster_obj = query.get_team_roster_player_info_by_week(
                    team_id=team_id, chosen_week=1
                )
            except Exception:
                roster_obj = []

            roster_players = []
            players_raw = getattr(roster_obj, "players", roster_obj) if not isinstance(roster_obj, list) else roster_obj

            for player_obj in (players_raw or []):
                pname = _extract_player_name(player_obj)
                if not pname:
                    continue
                pteam = _extract_player_team(player_obj)
                positions = _extract_player_positions(player_obj)
                player_key = getattr(player_obj, "player_key", None) or ""

                # Fetch per-game season stats
                try:
                    stats_obj = query.get_player_stats_by_season(player_key=player_key, chosen_season="2025")
                    pstats = {
                        "pts":       _extract_stat(stats_obj, _YAHOO_STAT_IDS["pts"], "pts"),
                        "reb":       _extract_stat(stats_obj, _YAHOO_STAT_IDS["reb"], "reb"),
                        "ast":       _extract_stat(stats_obj, _YAHOO_STAT_IDS["ast"], "ast"),
                        "stl":       _extract_stat(stats_obj, _YAHOO_STAT_IDS["stl"], "stl"),
                        "blk":       _extract_stat(stats_obj, _YAHOO_STAT_IDS["blk"], "blk"),
                        "tov":       _extract_stat(stats_obj, _YAHOO_STAT_IDS["tov"], "tov"),
                        "tpm":       _extract_stat(stats_obj, _YAHOO_STAT_IDS["tpm"], "tpm"),
                        "fg_pct":    _extract_stat(stats_obj, _YAHOO_STAT_IDS["fg_pct"], "fg_pct"),
                        "ft_pct":    _extract_stat(stats_obj, _YAHOO_STAT_IDS["ft_pct"], "ft_pct"),
                        "fg_att_pg": _extract_stat(stats_obj, _YAHOO_STAT_IDS["fg_att_pg"], "fg_att_pg"),
                        "ft_att_pg": _extract_stat(stats_obj, _YAHOO_STAT_IDS["ft_att_pg"], "ft_att_pg"),
                    }
                except Exception:
                    pstats = {k: 0.0 for k in ("pts", "reb", "ast", "stl", "blk", "tov", "tpm", "fg_pct", "ft_pct", "fg_att_pg", "ft_att_pg")}

                roster_players.append({
                    "name": pname,
                    "team": pteam,
                    "positions": positions,
                    "player_key": player_key,
                    "stats": pstats,
                })

            results.append({
                "team_key": str(team_key),
                "team_name": str(team_name),
                "manager_name": str(manager_name) if manager_name else None,
                "roster_players": roster_players,
            })

        return results

    team_data = await asyncio.get_event_loop().run_in_executor(None, _sync_fetch)

    # Build games_lookup
    schedule_rows = (await db.execute(select(TeamSchedule))).scalars().all()
    games_lookup: dict[tuple[str, int], int] = {
        (row.team, row.week_num): row.games_count for row in schedule_rows
    }

    teams_upserted = 0
    players_upserted = 0

    for team_info in team_data:
        roster_list: list[dict] = []

        for pdata in team_info["roster_players"]:
            pname = pdata["name"]
            pteam = pdata["team"]
            positions = pdata["positions"]
            stats = pdata["stats"]
            fantasy_ppg = round(compute_fantasy_ppg(stats), 3)

            # Upsert player (don't overwrite is_active on existing roster players)
            p_stmt = (
                insert(Player)
                .values(name=pname, team=pteam, positions=positions, is_active=False)
                .on_conflict_do_update(
                    constraint="uq_players_name",
                    set_={"team": pteam, "positions": positions},
                )
            )
            await db.execute(p_stmt)
            await db.flush()

            player = (
                await db.execute(select(Player).where(Player.name == pname))
            ).scalar_one_or_none()
            if not player:
                continue

            players_upserted += 1
            roster_list.append({"name": pname, "team": pteam, "positions": positions})

            for week_num in (21, 22, 23):
                games = games_lookup.get((pteam, week_num), 0)
                projected_total = round(fantasy_ppg * games, 2)

                proj_stmt = (
                    insert(PlayerProjection)
                    .values(
                        player_id=player.id,
                        week_num=week_num,
                        source="yahoo",
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
                await db.execute(proj_stmt)

        # Upsert YahooLeagueTeam
        team_stmt = (
            insert(YahooLeagueTeam)
            .values(
                team_key=team_info["team_key"],
                team_name=team_info["team_name"],
                manager_name=team_info["manager_name"],
                roster=roster_list,
                fetched_at=datetime.now(timezone.utc),
            )
            .on_conflict_do_update(
                constraint="uq_yahoo_team_key",
                set_={
                    "team_name": team_info["team_name"],
                    "manager_name": team_info["manager_name"],
                    "roster": roster_list,
                    "fetched_at": datetime.now(timezone.utc),
                },
            )
        )
        await db.execute(team_stmt)
        teams_upserted += 1

    await db.commit()

    print(f"[yahoo] Upserted {teams_upserted} teams, {players_upserted} player projections.")
    return {"teams_upserted": teams_upserted, "players_upserted": players_upserted}


# ---------------------------------------------------------------------------
# Live matchup schedule
# ---------------------------------------------------------------------------

async def fetch_yahoo_matchups(week_num: int) -> list[dict]:
    """
    Fetch the live matchup pairings from Yahoo Fantasy for a given week number.
    week_num is Yahoo's own week number (1-based from season start).
    Returns [{team_a_key, team_a_name, team_b_key, team_b_name}, ...]
    """
    def _sync_fetch() -> list[dict]:
        query, _ = _build_yahoo_query()

        try:
            matchups = query.get_league_matchups_by_week(chosen_week=week_num)
        except Exception as exc:
            print(f"[yahoo] get_league_matchups_by_week failed: {exc}")
            return []

        result: list[dict] = []
        for m in (matchups or []):
            teams = getattr(m, "teams", None)
            if teams is None and isinstance(m, dict):
                teams = m.get("teams", [])

            team_list = list(teams) if teams else []
            if len(team_list) < 2:
                continue

            def _tkey(t: Any) -> str:
                return str(getattr(t, "team_key", None) or (t.get("team_key", "") if isinstance(t, dict) else ""))

            def _tname(t: Any) -> str:
                for attr in ("name", "team_name"):
                    v = getattr(t, attr, None) or (t.get(attr) if isinstance(t, dict) else None)
                    if v:
                        return str(v)
                return ""

            result.append({
                "team_a_key": _tkey(team_list[0]),
                "team_a_name": _tname(team_list[0]),
                "team_b_key": _tkey(team_list[1]),
                "team_b_name": _tname(team_list[1]),
            })

        return result

    return await asyncio.get_event_loop().run_in_executor(None, _sync_fetch)
