"""
Basketball Monster / NBA-stats-style CSV import.

Supports two formats:
  Format A (classic BM):
    Player/Name, Team, Pos, GP, PTS, REB/TRB, AST, STL, BLK, TO/TOV, 3PM, FG%, FGA, FT%, FTA

  Format B (totals export, e.g. nba.com/stats style):
    first_name, last_name, games, field_goals, field_goals_attempted,
    free_throws, free_throws_attempted, threes, threes_attempted,
    offensive_rebounds, defensive_rebounds, assists, blocks, steals, tov

Usage:
  POST /ingest/bball-monster  multipart/form-data  file=<CSV>
"""

import io
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Player, PlayerProjection, TeamSchedule
from .projections import compute_fantasy_ppg

# ---------------------------------------------------------------------------
# Column name normalisation
# ---------------------------------------------------------------------------
_COL_ALIASES: dict[str, str] = {
    # player name
    "player": "name",
    "player name": "name",
    # position
    "pos": "position",
    # rebounds
    "trb": "reb",
    "total_rebounds": "reb",
    # turnovers
    "to": "tov",
    "turnovers": "tov",
    # 3-pointers made
    "3p": "tpm",
    "3pm": "tpm",
    "3-pm": "tpm",
    "threes": "tpm",
    # 3-pointers attempted
    "threes_attempted": "fg3_att",
    "3pa": "fg3_att",
    # field goals made
    "field_goals": "fgm",
    "fg": "fgm",
    # field goal attempts
    "fga": "fg_att",
    "field_goals_attempted": "fg_att",
    # free throws made
    "free_throws": "ftm",
    "ft": "ftm",
    # free throw attempts
    "fta": "ft_att",
    "free_throws_attempted": "ft_att",
    # rebounds breakdown
    "offensive_rebounds": "oreb",
    "orb": "oreb",
    "defensive_rebounds": "dreb",
    "drb": "dreb",
    # assists / blocks / steals
    "assists": "ast",
    "blocks": "blk",
    "steals": "stl",
    # percentages
    "fg%": "fg_pct",
    "ft%": "ft_pct",
    # games played
    "gp": "games",
    "g": "games",
    # minutes
    "mpg": "minutes",
    "mp": "minutes",
}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [c.strip().lower() for c in df.columns]
    df = df.rename(columns=_COL_ALIASES)
    return df


def _safe_float(val: Any) -> float:
    try:
        if pd.isna(val):
            return 0.0
    except (TypeError, ValueError):
        pass
    try:
        return float(str(val).replace("%", "").strip())
    except (ValueError, TypeError):
        return 0.0


def _parse_positions(pos_str: str) -> list[str]:
    from .projections import map_nba_position

    if not pos_str or pd.isna(pos_str):
        return ["SF", "PF"]

    pos_str = str(pos_str).strip()
    parts = [p.strip().upper() for p in pos_str.replace(",", "/").split("/")]

    fantasy = set()
    for part in parts:
        if part in ("PG", "SG", "SF", "PF", "C"):
            fantasy.add(part)
        else:
            mapped = map_nba_position(part.title())
            fantasy.update(mapped)

    return sorted(fantasy) if fantasy else ["SF", "PF"]


# ---------------------------------------------------------------------------
# Main ingestion function
# ---------------------------------------------------------------------------
async def ingest_bball_monster_csv(db: AsyncSession, csv_bytes: bytes) -> dict:
    try:
        df = pd.read_csv(io.BytesIO(csv_bytes))
    except Exception as exc:
        raise ValueError(f"Failed to parse CSV: {exc}") from exc

    df = _normalize_columns(df)

    # ---- Resolve player name ----
    # Format A: single 'name' column
    # Format B: separate 'first_name' + 'last_name' columns
    if "name" not in df.columns:
        if "first_name" in df.columns and "last_name" in df.columns:
            df["name"] = (
                df["first_name"].fillna("").str.strip()
                + " "
                + df["last_name"].fillna("").str.strip()
            ).str.strip()
        else:
            raise ValueError(
                "CSV must contain a 'Player'/'Name' column or both 'first_name' and "
                f"'last_name' columns. Found: {list(df.columns)}"
            )

    # Load schedule and existing players for lookups
    schedule_rows = (await db.execute(select(TeamSchedule))).scalars().all()
    games_lookup: dict[tuple[str, int], int] = {
        (row.team, row.week_num): row.games_count for row in schedule_rows
    }

    existing_players: dict[str, Player] = {
        p.name: p
        for p in (await db.execute(select(Player))).scalars().all()
    }

    # Determine if stats are totals (has 'games' column) or already per-game
    has_totals = "games" in df.columns

    upserted = 0
    skipped = 0

    for _, row in df.iterrows():
        pname = str(row["name"]).strip()
        if not pname or pname.lower() in ("nan", ""):
            skipped += 1
            continue

        gp = max(_safe_float(row.get("games", 1)), 1) if has_totals else 1

        # ---- Per-game stats ----
        # pts: use pts column if present, else derive from FGM/3PM/FTM totals
        if "pts" in df.columns:
            pts_pg = _safe_float(row.get("pts", 0)) / gp if has_totals else _safe_float(row.get("pts", 0))
        else:
            fgm = _safe_float(row.get("fgm", 0))
            tpm = _safe_float(row.get("tpm", 0))
            ftm = _safe_float(row.get("ftm", 0))
            pts_total = fgm * 2 + tpm + ftm  # (FGM−3PM)×2 + 3PM×3 + FTM = 2×FGM + 3PM + FTM
            pts_pg = pts_total / gp if has_totals else pts_total

        def _pg(col: str) -> float:
            v = _safe_float(row.get(col, 0))
            return v / gp if has_totals else v

        # reb: prefer 'reb' column, else sum oreb + dreb
        if "reb" in df.columns:
            reb_pg = _pg("reb")
        else:
            reb_pg = (_pg("oreb") + _pg("dreb"))

        # fg_att / ft_att
        fg_att_pg = _pg("fg_att")
        ft_att_pg = _pg("ft_att")

        # fg_pct / ft_pct — prefer direct columns, else derive from made/att
        if "fg_pct" in df.columns:
            fg_pct = _safe_float(row.get("fg_pct", 0))
            if fg_pct > 1.0:
                fg_pct /= 100.0
        elif fg_att_pg > 0:
            fgm_pg = _pg("fgm") if "fgm" in df.columns else pts_pg / 2  # rough fallback
            fg_pct = min(fgm_pg / fg_att_pg, 1.0) if fg_att_pg > 0 else 0.0
        else:
            fg_pct = 0.0

        if "ft_pct" in df.columns:
            ft_pct = _safe_float(row.get("ft_pct", 0))
            if ft_pct > 1.0:
                ft_pct /= 100.0
        elif ft_att_pg > 0:
            ftm_pg = _pg("ftm") if "ftm" in df.columns else 0.0
            ft_pct = min(ftm_pg / ft_att_pg, 1.0) if ft_att_pg > 0 else 0.0
        else:
            ft_pct = 0.0

        stats: dict[str, float] = {
            "pts":       round(pts_pg, 3),
            "reb":       round(reb_pg, 3),
            "ast":       round(_pg("ast"), 3),
            "stl":       round(_pg("stl"), 3),
            "blk":       round(_pg("blk"), 3),
            "tov":       round(_pg("tov"), 3),
            "tpm":       round(_pg("tpm"), 3),
            "fg_pct":    round(fg_pct, 4),
            "ft_pct":    round(ft_pct, 4),
            "fg_att_pg": round(fg_att_pg, 3),
            "ft_att_pg": round(ft_att_pg, 3),
        }

        fantasy_ppg = round(compute_fantasy_ppg(stats), 3)

        # ---- Team: CSV column first, fall back to existing DB record ----
        csv_team = str(row.get("team", "")).strip().upper()
        existing = existing_players.get(pname)
        team = csv_team if csv_team and csv_team != "NAN" else (existing.team if existing else "")

        # ---- Position: CSV first, fall back to existing DB record ----
        pos_raw = row.get("position", row.get("pos", ""))
        if pos_raw and str(pos_raw).strip() and str(pos_raw).lower() != "nan":
            positions = _parse_positions(str(pos_raw))
        elif existing:
            positions = existing.positions
        else:
            positions = ["SF", "PF"]

        # Upsert player (preserve is_active flag for existing players)
        p_stmt = (
            insert(Player)
            .values(name=pname, team=team, positions=positions, is_active=False)
            .on_conflict_do_update(
                constraint="uq_players_name",
                set_={"team": team, "positions": positions},
            )
        )
        await db.execute(p_stmt)
        await db.flush()

        player = (
            await db.execute(select(Player).where(Player.name == pname))
        ).scalar_one_or_none()
        if not player:
            skipped += 1
            continue

        for week_num in (21, 22, 23):
            games = games_lookup.get((team, week_num), 0)
            projected_total = round(fantasy_ppg * games, 2)

            proj_stmt = (
                insert(PlayerProjection)
                .values(
                    player_id=player.id,
                    week_num=week_num,
                    source="bball_monster",
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

        upserted += 1

    await db.commit()
    print(f"[bball_monster] Upserted {upserted} players, skipped {skipped}.")
    return {"upserted": upserted, "skipped": skipped}
