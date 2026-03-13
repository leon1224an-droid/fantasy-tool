"""
Basketball Monster CSV import.

Expected CSV columns (flexible naming):
  Player/Name, Team, Pos/Position, GP, MPG,
  FG%, FGA, FT%, FTA, 3PM/3P, PTS, REB/TRB, AST, STL, BLK, TO/TOV

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
from .projections import SCORING, compute_fantasy_ppg

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
    # turnovers
    "to": "tov",
    "turnovers": "tov",
    # 3-pointers
    "3p": "tpm",
    "3pm": "tpm",
    "3-pm": "tpm",
    # field goal attempts
    "fga": "fg_att",
    # free throw attempts
    "fta": "ft_att",
    # percentages
    "fg%": "fg_pct",
    "ft%": "ft_pct",
}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Lowercase + strip column names and apply known aliases."""
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
    """Convert 'PG/SG' or 'PG,SG' or 'Guard' etc. to list of fantasy positions."""
    from .projections import map_nba_position

    if not pos_str or pd.isna(pos_str):
        return ["SF", "PF"]

    pos_str = str(pos_str).strip()
    # Split on / or ,
    parts = [p.strip().upper() for p in pos_str.replace(",", "/").split("/")]

    fantasy = set()
    for part in parts:
        if part in ("PG", "SG", "SF", "PF", "C"):
            fantasy.add(part)
        else:
            # Try NBA position map
            mapped = map_nba_position(part.title())
            fantasy.update(mapped)

    return sorted(fantasy) if fantasy else ["SF", "PF"]


# ---------------------------------------------------------------------------
# Main ingestion function
# ---------------------------------------------------------------------------
async def ingest_bball_monster_csv(db: AsyncSession, csv_bytes: bytes) -> dict:
    """
    Parse a Basketball Monster CSV export and upsert PlayerProjection rows
    with source='bball_monster' for each playoff week.
    """
    try:
        df = pd.read_csv(io.BytesIO(csv_bytes))
    except Exception as exc:
        raise ValueError(f"Failed to parse CSV: {exc}") from exc

    df = _normalize_columns(df)

    if "name" not in df.columns:
        raise ValueError(
            "CSV must contain a 'Player' or 'Name' column. "
            f"Found columns: {list(df.columns)}"
        )

    # Load schedule for games_count lookup
    schedule_rows = (await db.execute(select(TeamSchedule))).scalars().all()
    games_lookup: dict[tuple[str, int], int] = {
        (row.team, row.week_num): row.games_count for row in schedule_rows
    }

    upserted = 0
    skipped = 0

    for _, row in df.iterrows():
        pname = str(row["name"]).strip()
        if not pname or pname.lower() in ("nan", ""):
            skipped += 1
            continue

        team = str(row.get("team", "")).strip().upper()
        pos_raw = row.get("position", row.get("pos", ""))
        positions = _parse_positions(str(pos_raw))

        stats: dict[str, float] = {
            "pts":       _safe_float(row.get("pts", 0)),
            "reb":       _safe_float(row.get("reb", 0)),
            "ast":       _safe_float(row.get("ast", 0)),
            "stl":       _safe_float(row.get("stl", 0)),
            "blk":       _safe_float(row.get("blk", 0)),
            "tov":       _safe_float(row.get("tov", 0)),
            "tpm":       _safe_float(row.get("tpm", 0)),
            "fg_pct":    _safe_float(row.get("fg_pct", 0)),
            "ft_pct":    _safe_float(row.get("ft_pct", 0)),
            "fg_att_pg": _safe_float(row.get("fg_att", 0)),
            "ft_att_pg": _safe_float(row.get("ft_att", 0)),
        }

        # fg_pct may be stored as 0-100 in some exports — normalise to 0-1
        if stats["fg_pct"] > 1.0:
            stats["fg_pct"] /= 100.0
        if stats["ft_pct"] > 1.0:
            stats["ft_pct"] /= 100.0

        fantasy_ppg = round(compute_fantasy_ppg(stats), 3)

        # Upsert player row
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
