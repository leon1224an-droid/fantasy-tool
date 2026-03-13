"""
Yahoo Fantasy Sports integration — calls the Yahoo Fantasy REST API directly
using httpx + OAuth2 refresh token. Does NOT use yfpy.

Required env vars:
  YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REFRESH_TOKEN, YAHOO_LEAGUE_ID
"""

import os
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Player, PlayerProjection, TeamSchedule, YahooLeagueTeam
from .projections import map_nba_position, ingest_projections

YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
YAHOO_API_BASE  = "https://fantasysports.yahooapis.com/fantasy/v2"
_TIMEOUT = 30.0


# ---------------------------------------------------------------------------
# Credentials + OAuth
# ---------------------------------------------------------------------------

def _require_credentials() -> tuple[str, str, str, str]:
    client_id     = os.getenv("YAHOO_CLIENT_ID", "")
    client_secret = os.getenv("YAHOO_CLIENT_SECRET", "")
    refresh_token = os.getenv("YAHOO_REFRESH_TOKEN", "")
    league_id     = os.getenv("YAHOO_LEAGUE_ID", "")

    missing = [n for n, v in [
        ("YAHOO_CLIENT_ID",     client_id),
        ("YAHOO_CLIENT_SECRET", client_secret),
        ("YAHOO_REFRESH_TOKEN", refresh_token),
        ("YAHOO_LEAGUE_ID",     league_id),
    ] if not v]

    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Yahoo credentials not configured. Missing env vars: {', '.join(missing)}",
        )
    return client_id, client_secret, refresh_token, league_id


async def _get_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    """Exchange refresh token for a fresh access token."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        resp = await c.post(
            YAHOO_TOKEN_URL,
            data={"grant_type": "refresh_token", "refresh_token": refresh_token, "redirect_uri": "oob"},
            auth=(client_id, client_secret),
        )
    if resp.status_code != 200:
        raise HTTPException(400, f"Failed to refresh Yahoo access token: {resp.text[:300]}")
    return resp.json()["access_token"]


async def _yget(token: str, path: str) -> dict:
    """Authenticated GET against Yahoo Fantasy v2 API, returns parsed JSON."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        resp = await c.get(
            f"{YAHOO_API_BASE}/{path}",
            headers={"Authorization": f"Bearer {token}"},
            params={"format": "json"},
        )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Yahoo API error [{path}]: {resp.text[:300]}")
    return resp.json()


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _dig(obj: Any, *keys) -> Any:
    """Safe nested accessor for mixed dict/list structures."""
    for k in keys:
        if obj is None:
            return None
        if isinstance(obj, dict):
            obj = obj.get(k)
        elif isinstance(obj, (list, tuple)) and isinstance(k, int):
            obj = obj[k] if k < len(obj) else None
        else:
            return None
    return obj


def _merge_attrs(attr_list: list) -> dict:
    """Yahoo packs team/player metadata as [{k:v}, {k:v}, ...] — merge to one dict."""
    result: dict = {}
    for item in attr_list:
        if isinstance(item, dict):
            result.update(item)
    return result


def _parse_positions(eligible: Any) -> list[str]:
    """Convert Yahoo eligible_positions to fantasy position list.

    Yahoo returns this field in several shapes:
      {"position": "PG"}               — single position
      {"position": ["PG", "G", "BN"]}  — multiple positions (dict form)
      [{"position": "PG"}, {"position": "G"}]  — list-of-dicts form
      "PG"                             — bare string (rare)
    """
    if not eligible:
        return ["SF", "PF"]

    # Normalise to a flat list of raw position strings
    raw_strs: list[str] = []

    if isinstance(eligible, str):
        raw_strs = [eligible]
    elif isinstance(eligible, dict):
        pos = eligible.get("position", [])
        if isinstance(pos, str):
            raw_strs = [pos]
        elif isinstance(pos, list):
            raw_strs = [str(p) for p in pos if not isinstance(p, dict)]
            # pos can itself be a list-of-dicts in edge cases
            for p in pos:
                if isinstance(p, dict):
                    v = p.get("position") or p.get("full") or ""
                    if v:
                        raw_strs.append(str(v))
    elif isinstance(eligible, list):
        for item in eligible:
            if isinstance(item, str):
                raw_strs.append(item)
            elif isinstance(item, dict):
                v = item.get("position") or item.get("full") or ""
                if v:
                    raw_strs.append(str(v))

    positions: set[str] = set()
    for p in raw_strs:
        p = p.upper().strip()
        if p in ("PG", "SG", "SF", "PF", "C"):
            positions.add(p)
        elif p == "G":
            positions.update(["PG", "SG"])
        elif p == "F":
            positions.update(["SF", "PF"])
        # skip IL, IL+, BN, UTIL, empty

    return sorted(positions) if positions else ["SF", "PF"]


# ---------------------------------------------------------------------------
# Yahoo API calls
# ---------------------------------------------------------------------------

async def _get_nba_game_id(token: str) -> int:
    """Return the current NBA season game_id from Yahoo."""
    data = await _yget(token, "game/nba")
    game = _dig(data, "fantasy_content", "game")
    if isinstance(game, list):
        return int(game[0]["game_id"])
    return int(game["game_id"])


async def _get_league_teams(token: str, league_key: str) -> list[dict]:
    """Return [{team_key, team_name, manager_name}] for all teams in the league."""
    data = await _yget(token, f"league/{league_key}/teams")
    raw = _dig(data, "fantasy_content", "league", 1, "teams") or {}

    teams = []
    for k, v in raw.items():
        if k == "count":
            continue
        team_arr = _dig(v, "team")
        if not team_arr:
            continue
        attrs = _merge_attrs(team_arr[0] if isinstance(team_arr[0], list) else [])

        team_key  = str(attrs.get("team_key", ""))
        team_name = str(attrs.get("name", f"Team {k}"))

        manager_name = None
        managers = attrs.get("managers")
        if managers:
            first = managers[0].get("manager", {}) if isinstance(managers[0], dict) else {}
            manager_name = first.get("nickname")

        teams.append({
            "team_key":     team_key,
            "team_name":    team_name,
            "manager_name": str(manager_name) if manager_name else None,
        })

    return teams


async def _get_team_roster(token: str, team_key: str) -> list[dict]:
    """Return [{name, team, positions}] for all players on a roster."""
    data = await _yget(token, f"team/{team_key}/roster")
    raw_players = _dig(data, "fantasy_content", "team", 1, "roster", "0", "players") or {}

    players = []
    for k, v in raw_players.items():
        if k == "count":
            continue
        player_arr = _dig(v, "player")
        if not player_arr:
            continue

        attrs_list = player_arr[0] if isinstance(player_arr[0], list) else []
        attrs = _merge_attrs(attrs_list)

        full_name = _dig(attrs, "name", "full") or attrs.get("full_name", "")
        if not full_name:
            continue

        team_abbr = str(attrs.get("editorial_team_abbr", "")).upper()
        raw_eligible = attrs.get("eligible_positions")
        positions = _parse_positions(raw_eligible)

        # Debug: log raw eligible_positions for first player of first team
        if not players:
            print(f"[yahoo] DEBUG eligible_positions sample ({full_name}): {raw_eligible!r} → {positions}")

        players.append({"name": full_name, "team": team_abbr, "positions": positions})

    return players


# ---------------------------------------------------------------------------
# Main ingestion
# ---------------------------------------------------------------------------

async def ingest_yahoo_league(db: AsyncSession) -> dict:
    """Fetch all Yahoo league teams + rosters and upsert into DB."""
    client_id, client_secret, refresh_token, league_id = _require_credentials()

    access_token = await _get_access_token(client_id, client_secret, refresh_token)
    game_id      = await _get_nba_game_id(access_token)
    league_key   = f"{game_id}.l.{league_id}"

    print(f"[yahoo] Using league_key={league_key}")

    teams = await _get_league_teams(access_token, league_key)
    if not teams:
        raise HTTPException(404, f"No teams found in Yahoo league {league_key}. Check YAHOO_LEAGUE_ID.")

    teams_upserted   = 0
    players_upserted = 0
    all_player_names: list[str] = []

    for team_info in teams:
        roster = await _get_team_roster(access_token, team_info["team_key"])

        roster_list: list[dict] = []
        for pdata in roster:
            pname     = pdata["name"]
            pteam     = pdata["team"]
            positions = pdata["positions"]

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

            players_upserted += 1
            all_player_names.append(pname)
            roster_list.append({"name": pname, "team": pteam, "positions": positions})

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
                    "team_name":    team_info["team_name"],
                    "manager_name": team_info["manager_name"],
                    "roster":       roster_list,
                    "fetched_at":   datetime.now(timezone.utc),
                },
            )
        )
        await db.execute(team_stmt)
        teams_upserted += 1

    await db.commit()
    print(f"[yahoo] Upserted {teams_upserted} teams, {players_upserted} players.")

    # Fetch NBA stats projections for all Yahoo-rostered players so league
    # rankings have real stat totals (not just the 13 active roster players).
    from sqlalchemy import select as sa_select
    ingested_players = (
        await db.execute(
            sa_select(Player).where(Player.name.in_(all_player_names))
        )
    ).scalars().all()
    print(f"[yahoo] Fetching NBA projections for {len(ingested_players)} rostered players…")
    await ingest_projections(db, players=ingested_players)

    return {"teams_upserted": teams_upserted, "players_upserted": players_upserted}


# ---------------------------------------------------------------------------
# Live matchup schedule
# ---------------------------------------------------------------------------

async def fetch_yahoo_matchups(week_num: int) -> list[dict]:
    """
    Fetch live matchup pairings from Yahoo Fantasy for the given Yahoo week number.
    Returns [{team_a_key, team_a_name, team_b_key, team_b_name}, ...]
    """
    client_id, client_secret, refresh_token, league_id = _require_credentials()
    access_token = await _get_access_token(client_id, client_secret, refresh_token)
    game_id      = await _get_nba_game_id(access_token)
    league_key   = f"{game_id}.l.{league_id}"

    data = await _yget(access_token, f"league/{league_key}/scoreboard;week={week_num}")
    matchups_raw = _dig(data, "fantasy_content", "league", 1, "scoreboard", "0", "matchups") or {}

    result = []
    for k, v in matchups_raw.items():
        if k == "count":
            continue
        matchup = _dig(v, "matchup")
        if not matchup:
            continue

        teams_raw = _dig(matchup, "0", "teams") or {}
        team_keys:  list[str] = []
        team_names: list[str] = []

        for tk, tv in teams_raw.items():
            if tk == "count":
                continue
            team_arr = _dig(tv, "team")
            if not team_arr:
                continue
            attrs = _merge_attrs(team_arr[0] if isinstance(team_arr[0], list) else [])
            team_keys.append(str(attrs.get("team_key", "")))
            team_names.append(str(attrs.get("name", "")))

        if len(team_keys) >= 2:
            result.append({
                "team_a_key":  team_keys[0],
                "team_a_name": team_names[0],
                "team_b_key":  team_keys[1],
                "team_b_name": team_names[1],
            })

    return result
