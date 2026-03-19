"""add users auth and per-user data isolation

Revision ID: a1b2c3d4e5f6
Revises: e9c3a7b20f14
Create Date: 2026-03-15 00:00:00.000000

Changes:
  - Create users table
  - Create refresh_tokens table
  - Add user_id (nullable) to players, saved_rosters, yahoo_league_teams,
    projection_source_settings
  - Drop old global unique constraints; add new per-user unique constraints
"""

from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "e9c3a7b20f14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -------------------------------------------------------------------------
    # 1. users table
    # -------------------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("yahoo_refresh_token", sa.String(2048), nullable=True),
        sa.Column("yahoo_access_token", sa.String(2048), nullable=True),
        sa.Column("yahoo_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("yahoo_league_id", sa.String(50), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )

    # -------------------------------------------------------------------------
    # 2. refresh_tokens table
    # -------------------------------------------------------------------------
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default="false"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )

    # -------------------------------------------------------------------------
    # 3. players — add user_id, replace unique constraint
    # -------------------------------------------------------------------------
    op.add_column("players", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_players_user_id",
        "players", "users",
        ["user_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_players_user_id", "players", ["user_id"])

    # Drop the old global unique constraint on name
    op.drop_constraint("uq_players_name", "players", type_="unique")
    # Add new per-user unique constraint
    op.create_unique_constraint("uq_players_name_user", "players", ["name", "user_id"])

    # -------------------------------------------------------------------------
    # 4. saved_rosters — add user_id, replace unique constraint
    # -------------------------------------------------------------------------
    op.add_column("saved_rosters", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_saved_rosters_user_id",
        "saved_rosters", "users",
        ["user_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_saved_rosters_user_id", "saved_rosters", ["user_id"])

    op.drop_constraint("uq_saved_roster_name", "saved_rosters", type_="unique")
    op.create_unique_constraint(
        "uq_saved_roster_name_user", "saved_rosters", ["name", "user_id"]
    )

    # -------------------------------------------------------------------------
    # 5. yahoo_league_teams — add user_id, replace unique constraint
    # -------------------------------------------------------------------------
    op.add_column("yahoo_league_teams", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_yahoo_league_teams_user_id",
        "yahoo_league_teams", "users",
        ["user_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_yahoo_league_teams_user_id", "yahoo_league_teams", ["user_id"])

    op.drop_constraint("uq_yahoo_team_key", "yahoo_league_teams", type_="unique")
    op.create_unique_constraint(
        "uq_yahoo_team_key_user", "yahoo_league_teams", ["team_key", "user_id"]
    )

    # -------------------------------------------------------------------------
    # 6. projection_source_settings — add user_id, add unique constraint
    # -------------------------------------------------------------------------
    op.add_column(
        "projection_source_settings", sa.Column("user_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        "fk_proj_source_user_id",
        "projection_source_settings", "users",
        ["user_id"], ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_proj_source_user_id", "projection_source_settings", ["user_id"]
    )
    op.create_unique_constraint(
        "uq_proj_source_user", "projection_source_settings", ["user_id"]
    )


def downgrade() -> None:
    # Reverse projection_source_settings changes
    op.drop_constraint("uq_proj_source_user", "projection_source_settings", type_="unique")
    op.drop_index("ix_proj_source_user_id", table_name="projection_source_settings")
    op.drop_constraint("fk_proj_source_user_id", "projection_source_settings", type_="foreignkey")
    op.drop_column("projection_source_settings", "user_id")

    # Reverse yahoo_league_teams changes
    op.drop_constraint("uq_yahoo_team_key_user", "yahoo_league_teams", type_="unique")
    op.drop_index("ix_yahoo_league_teams_user_id", table_name="yahoo_league_teams")
    op.drop_constraint("fk_yahoo_league_teams_user_id", "yahoo_league_teams", type_="foreignkey")
    op.drop_column("yahoo_league_teams", "user_id")
    op.create_unique_constraint("uq_yahoo_team_key", "yahoo_league_teams", ["team_key"])

    # Reverse saved_rosters changes
    op.drop_constraint("uq_saved_roster_name_user", "saved_rosters", type_="unique")
    op.drop_index("ix_saved_rosters_user_id", table_name="saved_rosters")
    op.drop_constraint("fk_saved_rosters_user_id", "saved_rosters", type_="foreignkey")
    op.drop_column("saved_rosters", "user_id")
    op.create_unique_constraint("uq_saved_roster_name", "saved_rosters", ["name"])

    # Reverse players changes
    op.drop_constraint("uq_players_name_user", "players", type_="unique")
    op.drop_index("ix_players_user_id", table_name="players")
    op.drop_constraint("fk_players_user_id", "players", type_="foreignkey")
    op.drop_column("players", "user_id")
    op.create_unique_constraint("uq_players_name", "players", ["name"])

    # Drop new tables
    op.drop_table("refresh_tokens")
    op.drop_table("users")
