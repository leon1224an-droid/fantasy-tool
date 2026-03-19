"""Add API fetch timestamps for call deduplication.

- users.nba_projections_fetched_at — tracks last NBA Stats API call per user (1/day throttle)

Revision ID: d5e8f1a2b3c4
Revises: a1b2c3d4e5f6
Create Date: 2026-03-16

"""

from alembic import op
import sqlalchemy as sa

revision = "d5e8f1a2b3c4"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "nba_projections_fetched_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "nba_projections_fetched_at")
