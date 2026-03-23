"""
Projection source management — read and set the active projection source per user.
"""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ProjectionSourceSetting

VALID_SOURCES = {"yahoo", "bball_monster", "blended"}
DEFAULT_SOURCE = "bball_monster"


async def get_active_source(db: AsyncSession, user_id: int) -> str:
    """Return the current active source for a user, defaulting to 'bball_monster'."""
    row = (
        await db.execute(
            select(ProjectionSourceSetting).where(
                ProjectionSourceSetting.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    return row.active_source if row else DEFAULT_SOURCE


async def set_active_source(db: AsyncSession, source: str, user_id: int) -> str:
    """Upsert the user's source setting and return the new active source."""
    if source not in VALID_SOURCES:
        raise ValueError(
            f"Invalid source '{source}'. Must be one of: {sorted(VALID_SOURCES)}"
        )
    stmt = (
        insert(ProjectionSourceSetting)
        .values(user_id=user_id, active_source=source)
        .on_conflict_do_update(
            constraint="uq_proj_source_user",
            set_={"active_source": source},
        )
    )
    await db.execute(stmt)
    await db.commit()
    return source
