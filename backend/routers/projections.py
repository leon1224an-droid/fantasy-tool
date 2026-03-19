"""
Projection source management and blended projection endpoints:
  GET  /projections/source          — get active source
  POST /projections/source          — set active source
  POST /projections/blend           — compute blended projections
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth_utils import get_current_user
from ..database import get_db
from ..ingestion.source import VALID_SOURCES, get_active_source, set_active_source
from ..models import Player, PlayerProjection, User

router = APIRouter(prefix="/projections", tags=["projections"])


class ProjectionSourceResponse(BaseModel):
    active_source: str
    valid_sources: list[str]


class SetSourceRequest(BaseModel):
    source: str


class BlendWeightsRequest(BaseModel):
    weights: dict[str, float]


class BlendResponse(BaseModel):
    status: str
    players_blended: int


@router.get("/source", response_model=ProjectionSourceResponse)
async def get_projection_source(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the current active projection source for the authenticated user."""
    active = await get_active_source(db, user_id=current_user.id)
    return ProjectionSourceResponse(
        active_source=active,
        valid_sources=sorted(VALID_SOURCES),
    )


@router.post("/source", response_model=ProjectionSourceResponse)
async def set_projection_source(
    body: SetSourceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Set the active projection source for the authenticated user.
    Must be one of: nba_api | yahoo | bball_monster | blended
    """
    try:
        active = await set_active_source(db, body.source, user_id=current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ProjectionSourceResponse(
        active_source=active,
        valid_sources=sorted(VALID_SOURCES),
    )


@router.post("/blend", response_model=BlendResponse)
async def blend_projections(
    body: BlendWeightsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Compute weighted-average projections across available sources and store
    them as source='blended' for the authenticated user.
    Weights are normalised to sum to 1.

    Example: {"weights": {"nba_api": 0.4, "yahoo": 0.3, "bball_monster": 0.3}}
    """
    weights = {k: float(v) for k, v in body.weights.items() if float(v) > 0}
    if not weights:
        raise HTTPException(status_code=400, detail="Provide at least one positive weight.")

    invalid = set(weights) - VALID_SOURCES
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown sources: {invalid}")

    total_w = sum(weights.values())
    weights = {k: v / total_w for k, v in weights.items()}

    # Load projections for each source (scoped to this user's players)
    source_projs: dict[str, dict[tuple[int, int], PlayerProjection]] = {}
    for src in weights:
        rows = (
            await db.execute(
                select(PlayerProjection)
                .join(Player, Player.id == PlayerProjection.player_id)
                .where(
                    Player.user_id == current_user.id,
                    PlayerProjection.source == src,
                )
            )
        ).scalars().all()
        source_projs[src] = {(r.player_id, r.week_num): r for r in rows}

    # All (player_id, week_num) combos across sources
    all_keys: set[tuple[int, int]] = set()
    for src_dict in source_projs.values():
        all_keys.update(src_dict.keys())

    blended_count = 0

    for player_id, week_num in all_keys:
        def _blend(field_name: str) -> float:
            total = 0.0
            wt_sum = 0.0
            for src, w in weights.items():
                row = source_projs[src].get((player_id, week_num))
                if row:
                    total += getattr(row, field_name, 0.0) * w
                    wt_sum += w
            return round(total / wt_sum, 4) if wt_sum > 0 else 0.0

        primary_src = max(weights, key=lambda s: weights[s])
        primary_row = source_projs[primary_src].get((player_id, week_num))
        games_count = primary_row.games_count if primary_row else 0

        fantasy_ppg = _blend("fantasy_ppg")
        projected_total = round(fantasy_ppg * games_count, 2)

        stmt = (
            insert(PlayerProjection)
            .values(
                player_id=player_id,
                week_num=week_num,
                source="blended",
                games_count=games_count,
                pts_pg=_blend("pts_pg"),
                reb_pg=_blend("reb_pg"),
                ast_pg=_blend("ast_pg"),
                stl_pg=_blend("stl_pg"),
                blk_pg=_blend("blk_pg"),
                tov_pg=_blend("tov_pg"),
                tpm_pg=_blend("tpm_pg"),
                fg_pct=_blend("fg_pct"),
                ft_pct=_blend("ft_pct"),
                fg_att_pg=_blend("fg_att_pg"),
                ft_att_pg=_blend("ft_att_pg"),
                fantasy_ppg=fantasy_ppg,
                projected_total=projected_total,
            )
            .on_conflict_do_update(
                constraint="uq_projection_player_week_source",
                set_={
                    "games_count":      games_count,
                    "pts_pg":           _blend("pts_pg"),
                    "reb_pg":           _blend("reb_pg"),
                    "ast_pg":           _blend("ast_pg"),
                    "stl_pg":           _blend("stl_pg"),
                    "blk_pg":           _blend("blk_pg"),
                    "tov_pg":           _blend("tov_pg"),
                    "tpm_pg":           _blend("tpm_pg"),
                    "fg_pct":           _blend("fg_pct"),
                    "ft_pct":           _blend("ft_pct"),
                    "fg_att_pg":        _blend("fg_att_pg"),
                    "ft_att_pg":        _blend("ft_att_pg"),
                    "fantasy_ppg":      fantasy_ppg,
                    "projected_total":  projected_total,
                },
            )
        )
        await db.execute(stmt)
        blended_count += 1

    await db.commit()
    return BlendResponse(status="ok", players_blended=blended_count)
