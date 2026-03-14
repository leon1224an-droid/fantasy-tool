"""set default projection source to bball_monster

Revision ID: e9c3a7b20f14
Revises: b4c8e2d1f093
Create Date: 2026-03-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = "e9c3a7b20f14"
down_revision: Union[str, None] = "b4c8e2d1f093"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE projection_source_settings SET active_source = 'bball_monster' WHERE active_source = 'nba_api'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE projection_source_settings SET active_source = 'nba_api' WHERE active_source = 'bball_monster'"
    )
