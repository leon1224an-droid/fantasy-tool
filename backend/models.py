"""
ORM models: Player, TeamSchedule, PlayerProjection.
All share the Base declared in database.py.
"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Player(Base):
    __tablename__ = "players"
    __table_args__ = (UniqueConstraint("name", name="uq_players_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    team: Mapped[str] = mapped_column(String(5), nullable=False)
    positions: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    projections: Mapped[list["PlayerProjection"]] = relationship(
        back_populates="player", cascade="all, delete-orphan"
    )


class TeamSchedule(Base):
    """Games played per team per playoff week."""

    __tablename__ = "team_schedules"
    __table_args__ = (
        UniqueConstraint("team", "week_num", name="uq_team_schedule_team_week"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team: Mapped[str] = mapped_column(String(5), nullable=False)
    week_num: Mapped[int] = mapped_column(Integer, nullable=False)
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    week_end: Mapped[date] = mapped_column(Date, nullable=False)
    games_count: Mapped[int] = mapped_column(Integer, nullable=False)


class GameDay(Base):
    """One row per team per game date — used for daily lineup optimization."""

    __tablename__ = "game_days"
    __table_args__ = (
        UniqueConstraint("team", "game_date", name="uq_game_day_team_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team: Mapped[str] = mapped_column(String(5), nullable=False)
    week_num: Mapped[int] = mapped_column(Integer, nullable=False)
    game_date: Mapped[date] = mapped_column(Date, nullable=False)
    day_label: Mapped[str] = mapped_column(String(10), nullable=False)  # e.g. "Mon 3/16"


class PlayerProjection(Base):
    """
    Per-game stat projections for a player in a given playoff week.
    projected_total = fantasy_ppg * games_count for that week.
    """

    __tablename__ = "player_projections"
    __table_args__ = (
        UniqueConstraint("player_id", "week_num", name="uq_projection_player_week"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("players.id", ondelete="CASCADE"), nullable=False
    )
    week_num: Mapped[int] = mapped_column(Integer, nullable=False)

    # Denormalised game count (copied from TeamSchedule for convenience)
    games_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Per-game raw stats
    pts_pg: Mapped[float] = mapped_column(Float, default=0.0)
    reb_pg: Mapped[float] = mapped_column(Float, default=0.0)
    ast_pg: Mapped[float] = mapped_column(Float, default=0.0)
    stl_pg: Mapped[float] = mapped_column(Float, default=0.0)
    blk_pg: Mapped[float] = mapped_column(Float, default=0.0)
    tov_pg: Mapped[float] = mapped_column(Float, default=0.0)
    tpm_pg: Mapped[float] = mapped_column(Float, default=0.0)  # 3PM
    fg_pct: Mapped[float] = mapped_column(Float, default=0.0)
    ft_pct: Mapped[float] = mapped_column(Float, default=0.0)

    # Derived fantasy values
    fantasy_ppg: Mapped[float] = mapped_column(Float, default=0.0)
    projected_total: Mapped[float] = mapped_column(Float, default=0.0)

    player: Mapped["Player"] = relationship(back_populates="projections")


class SavedRoster(Base):
    """A named snapshot of a player list, used for compare and quick-load."""

    __tablename__ = "saved_rosters"
    __table_args__ = (UniqueConstraint("name", name="uq_saved_roster_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Stored as [{name, team, positions}]
    players: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
