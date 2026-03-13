"""add source, fg_att_pg, ft_att_pg to projections; add ProjectionSourceSetting and YahooLeagueTeam

Revision ID: f7a2e1b9c8d5
Revises: a3f1c9d20e44
Create Date: 2026-03-12 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7a2e1b9c8d5"
down_revision: Union[str, None] = "a3f1c9d20e44"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- player_projections ---------------------------------------------------

    # 1. Add new columns (nullable first to allow backfill)
    op.add_column(
        "player_projections",
        sa.Column("source", sa.String(20), nullable=True),
    )
    op.add_column(
        "player_projections",
        sa.Column("fg_att_pg", sa.Float(), nullable=True, server_default="0.0"),
    )
    op.add_column(
        "player_projections",
        sa.Column("ft_att_pg", sa.Float(), nullable=True, server_default="0.0"),
    )

    # 2. Backfill source for existing rows
    op.execute("UPDATE player_projections SET source = 'nba_api' WHERE source IS NULL")
    op.execute("UPDATE player_projections SET fg_att_pg = 0.0 WHERE fg_att_pg IS NULL")
    op.execute("UPDATE player_projections SET ft_att_pg = 0.0 WHERE ft_att_pg IS NULL")

    # 3. Make source NOT NULL now that it's backfilled
    op.alter_column("player_projections", "source", nullable=False)
    op.alter_column("player_projections", "fg_att_pg", nullable=False)
    op.alter_column("player_projections", "ft_att_pg", nullable=False)

    # 4. Drop old unique constraint (player_id, week_num)
    op.drop_constraint("uq_projection_player_week", "player_projections", type_="unique")

    # 5. Create new unique constraint (player_id, week_num, source)
    op.create_unique_constraint(
        "uq_projection_player_week_source",
        "player_projections",
        ["player_id", "week_num", "source"],
    )

    # --- projection_source_settings ------------------------------------------
    op.create_table(
        "projection_source_settings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("active_source", sa.String(20), nullable=False, server_default="nba_api"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # --- yahoo_league_teams ---------------------------------------------------
    op.create_table(
        "yahoo_league_teams",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("team_key", sa.String(50), nullable=False),
        sa.Column("team_name", sa.String(100), nullable=False),
        sa.Column("manager_name", sa.String(100), nullable=True),
        sa.Column(
            "roster",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_key", name="uq_yahoo_team_key"),
    )


def downgrade() -> None:
    # Drop new tables
    op.drop_table("yahoo_league_teams")
    op.drop_table("projection_source_settings")

    # Restore player_projections
    op.drop_constraint("uq_projection_player_week_source", "player_projections", type_="unique")
    op.create_unique_constraint(
        "uq_projection_player_week",
        "player_projections",
        ["player_id", "week_num"],
    )
    op.drop_column("player_projections", "ft_att_pg")
    op.drop_column("player_projections", "fg_att_pg")
    op.drop_column("player_projections", "source")
