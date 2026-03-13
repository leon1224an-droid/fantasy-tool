"""
Projection source management — read and set the active projection source.
"""

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ProjectionSourceSetting

VALID_SOURCES = {"nba_api", "yahoo", "bball_monster", "blended"}


async def get_active_source(db: AsyncSession) -> str:
    """Return the current active source, defaulting to 'nba_api' if not set."""
    row = (await db.execute(select(ProjectionSourceSetting))).scalar_one_or_none()
    return row.active_source if row else "nba_api"


async def set_active_source(db: AsyncSession, source: str) -> str:
    """Upsert the single config row and return the new active source."""
    if source not in VALID_SOURCES:
        raise ValueError(f"Invalid source '{source}'. Must be one of: {sorted(VALID_SOURCES)}")
    stmt = (
        insert(ProjectionSourceSetting)
        .values(id=1, active_source=source)
        .on_conflict_do_update(
            index_elements=["id"],
            set_={"active_source": source, "updated_at": func.now()},
        )
    )
    await db.execute(stmt)
    await db.commit()
    return source
