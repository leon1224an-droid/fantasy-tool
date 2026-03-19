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
    # Use raw SQL with IF NOT EXISTS / IF EXISTS throughout so this migration
    # is safe to run even if it was partially applied or the DB is in an
    # unexpected state.

    # -------------------------------------------------------------------------
    # 1. users table
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            username VARCHAR(100) NOT NULL,
            hashed_password VARCHAR(255) NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            is_admin BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            yahoo_refresh_token VARCHAR(2048),
            yahoo_access_token VARCHAR(2048),
            yahoo_token_expires_at TIMESTAMPTZ,
            yahoo_league_id VARCHAR(50)
        )
    """)
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_email")
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_username")
    op.execute("ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email)")
    op.execute("ALTER TABLE users ADD CONSTRAINT uq_users_username UNIQUE (username)")

    # -------------------------------------------------------------------------
    # 2. refresh_tokens table
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash VARCHAR(64) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)
    op.execute("ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_token_hash_key")
    op.execute("ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash)")

    # -------------------------------------------------------------------------
    # 3. players — add user_id, replace unique constraint
    # -------------------------------------------------------------------------
    op.execute("ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id INTEGER")
    op.execute("ALTER TABLE players DROP CONSTRAINT IF EXISTS fk_players_user_id")
    op.execute("ALTER TABLE players ADD CONSTRAINT fk_players_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE")
    op.execute("DROP INDEX IF EXISTS ix_players_user_id")
    op.execute("CREATE INDEX IF NOT EXISTS ix_players_user_id ON players (user_id)")
    op.execute("ALTER TABLE players DROP CONSTRAINT IF EXISTS uq_players_name")
    op.execute("ALTER TABLE players DROP CONSTRAINT IF EXISTS uq_players_name_user")
    op.execute("ALTER TABLE players ADD CONSTRAINT uq_players_name_user UNIQUE (name, user_id)")

    # -------------------------------------------------------------------------
    # 4. saved_rosters — add user_id, replace unique constraint
    # -------------------------------------------------------------------------
    op.execute("ALTER TABLE saved_rosters ADD COLUMN IF NOT EXISTS user_id INTEGER")
    op.execute("ALTER TABLE saved_rosters DROP CONSTRAINT IF EXISTS fk_saved_rosters_user_id")
    op.execute("ALTER TABLE saved_rosters ADD CONSTRAINT fk_saved_rosters_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE")
    op.execute("DROP INDEX IF EXISTS ix_saved_rosters_user_id")
    op.execute("CREATE INDEX IF NOT EXISTS ix_saved_rosters_user_id ON saved_rosters (user_id)")
    op.execute("ALTER TABLE saved_rosters DROP CONSTRAINT IF EXISTS uq_saved_roster_name")
    op.execute("ALTER TABLE saved_rosters DROP CONSTRAINT IF EXISTS uq_saved_roster_name_user")
    op.execute("ALTER TABLE saved_rosters ADD CONSTRAINT uq_saved_roster_name_user UNIQUE (name, user_id)")

    # -------------------------------------------------------------------------
    # 5. yahoo_league_teams — add user_id, replace unique constraint
    # -------------------------------------------------------------------------
    op.execute("ALTER TABLE yahoo_league_teams ADD COLUMN IF NOT EXISTS user_id INTEGER")
    op.execute("ALTER TABLE yahoo_league_teams DROP CONSTRAINT IF EXISTS fk_yahoo_league_teams_user_id")
    op.execute("ALTER TABLE yahoo_league_teams ADD CONSTRAINT fk_yahoo_league_teams_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE")
    op.execute("DROP INDEX IF EXISTS ix_yahoo_league_teams_user_id")
    op.execute("CREATE INDEX IF NOT EXISTS ix_yahoo_league_teams_user_id ON yahoo_league_teams (user_id)")
    op.execute("ALTER TABLE yahoo_league_teams DROP CONSTRAINT IF EXISTS uq_yahoo_team_key")
    op.execute("ALTER TABLE yahoo_league_teams DROP CONSTRAINT IF EXISTS uq_yahoo_team_key_user")
    op.execute("ALTER TABLE yahoo_league_teams ADD CONSTRAINT uq_yahoo_team_key_user UNIQUE (team_key, user_id)")

    # -------------------------------------------------------------------------
    # 6. projection_source_settings — add user_id, add unique constraint
    # -------------------------------------------------------------------------
    op.execute("ALTER TABLE projection_source_settings ADD COLUMN IF NOT EXISTS user_id INTEGER")
    op.execute("ALTER TABLE projection_source_settings DROP CONSTRAINT IF EXISTS fk_proj_source_user_id")
    op.execute("ALTER TABLE projection_source_settings ADD CONSTRAINT fk_proj_source_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE")
    op.execute("DROP INDEX IF EXISTS ix_proj_source_user_id")
    op.execute("CREATE INDEX IF NOT EXISTS ix_proj_source_user_id ON projection_source_settings (user_id)")
    op.execute("ALTER TABLE projection_source_settings DROP CONSTRAINT IF EXISTS uq_proj_source_user")
    op.execute("ALTER TABLE projection_source_settings ADD CONSTRAINT uq_proj_source_user UNIQUE (user_id)")


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
