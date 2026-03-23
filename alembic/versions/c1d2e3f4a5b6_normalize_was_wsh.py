"""Normalize WSH → WAS in team_schedules, game_days, and players tables.

ESPN uses WSH for the Washington Wizards; the NBA standard abbreviation is WAS.
Rows may have been written with either code depending on ingestion timing.
This migration canonicalises all existing rows to WAS.

Revision ID: c1d2e3f4a5b6
Revises: d5e8f1a2b3c4
Create Date: 2026-03-19
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "d5e8f1a2b3c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # If a canonical WAS row already exists for the same (team, week_num) / (team, game_date),
    # the duplicate WSH row is stale — delete it.  Otherwise rename it to WAS.
    op.execute("""
        DELETE FROM team_schedules s
        USING team_schedules canon
        WHERE s.team = 'WSH'
          AND canon.team = 'WAS'
          AND canon.week_num = s.week_num
    """)
    op.execute("UPDATE team_schedules SET team = 'WAS' WHERE team = 'WSH'")

    op.execute("""
        DELETE FROM game_days d
        USING game_days canon
        WHERE d.team = 'WSH'
          AND canon.team = 'WAS'
          AND canon.game_date = d.game_date
    """)
    op.execute("UPDATE game_days SET team = 'WAS' WHERE team = 'WSH'")

    # players.team is not part of any unique key — safe to UPDATE directly
    op.execute("UPDATE players SET team = 'WAS' WHERE team = 'WSH'")


def downgrade() -> None:
    op.execute("UPDATE team_schedules SET team = 'WSH' WHERE team = 'WAS'")
    op.execute("UPDATE game_days    SET team = 'WSH' WHERE team = 'WAS'")
    op.execute("UPDATE players      SET team = 'WSH' WHERE team = 'WAS'")
