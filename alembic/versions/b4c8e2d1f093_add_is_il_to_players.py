"""add is_il column to players

Revision ID: b4c8e2d1f093
Revises: f7a2e1b9c8d5
Create Date: 2026-03-13 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4c8e2d1f093"
down_revision: Union[str, None] = "f7a2e1b9c8d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "players",
        sa.Column("is_il", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("players", "is_il")
