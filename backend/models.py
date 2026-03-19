"""
ORM models.

Shared data (no user_id):
  TeamSchedule, GameDay — NBA schedule, same for all users.

Per-user data (user_id FK required):
  Player, SavedRoster, YahooLeagueTeam, ProjectionSourceSetting.
  PlayerProjection is linked to Player (which is per-user), so it is
  implicitly per-user without needing its own user_id column.

Auth:
  User, RefreshToken.
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


# ---------------------------------------------------------------------------
# Auth models
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        UniqueConstraint("username", name="uq_users_username"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Tracks when NBA Stats API was last called for this user (throttle: 1/day)
    nba_projections_fetched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Yahoo per-user credentials (app client_id/secret stay in env vars)
    yahoo_refresh_token: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    yahoo_access_token: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    yahoo_token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    yahoo_league_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Relationships
    players: Mapped[list["Player"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    saved_rosters: Mapped[list["SavedRoster"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    yahoo_teams: Mapped[list["YahooLeagueTeam"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    projection_source: Mapped["ProjectionSourceSetting | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")


# ---------------------------------------------------------------------------
# Per-user data models
# ---------------------------------------------------------------------------

class Player(Base):
    __tablename__ = "players"
    __table_args__ = (
        UniqueConstraint("name", "user_id", name="uq_players_name_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    team: Mapped[str] = mapped_column(String(5), nullable=False)
    positions: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_il: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped["User"] = relationship(back_populates="players")
    projections: Mapped[list["PlayerProjection"]] = relationship(
        back_populates="player", cascade="all, delete-orphan"
    )


class SavedRoster(Base):
    """A named snapshot of a player list, used for compare and quick-load."""

    __tablename__ = "saved_rosters"
    __table_args__ = (
        UniqueConstraint("name", "user_id", name="uq_saved_roster_name_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Stored as [{name, team, positions}]
    players: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="saved_rosters")


class ProjectionSourceSetting(Base):
    """One row per user tracking which projection source is active for them."""

    __tablename__ = "projection_source_settings"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_proj_source_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    active_source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="nba_api"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="projection_source")


class YahooLeagueTeam(Base):
    """One row per Yahoo Fantasy team per user in the league."""

    __tablename__ = "yahoo_league_teams"
    __table_args__ = (
        UniqueConstraint("team_key", "user_id", name="uq_yahoo_team_key_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    team_key: Mapped[str] = mapped_column(String(50), nullable=False)
    team_name: Mapped[str] = mapped_column(String(100), nullable=False)
    manager_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # [{name, team, positions, is_il}]
    roster: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="yahoo_teams")


# ---------------------------------------------------------------------------
# Shared / global data models (no user_id)
# ---------------------------------------------------------------------------

class TeamSchedule(Base):
    """Games played per team per playoff week — shared across all users."""

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
    """One row per team per game date — shared across all users."""

    __tablename__ = "game_days"
    __table_args__ = (
        UniqueConstraint("team", "game_date", name="uq_game_day_team_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team: Mapped[str] = mapped_column(String(5), nullable=False)
    week_num: Mapped[int] = mapped_column(Integer, nullable=False)
    game_date: Mapped[date] = mapped_column(Date, nullable=False)
    day_label: Mapped[str] = mapped_column(String(10), nullable=False)


class PlayerProjection(Base):
    """
    Per-game stat projections for a player in a given playoff week.
    Linked to a per-user Player row, so implicitly per-user.
    source: 'nba_api' | 'yahoo' | 'bball_monster' | 'blended'
    """

    __tablename__ = "player_projections"
    __table_args__ = (
        UniqueConstraint(
            "player_id", "week_num", "source",
            name="uq_projection_player_week_source",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("players.id", ondelete="CASCADE"), nullable=False
    )
    week_num: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="nba_api"
    )

    games_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    pts_pg: Mapped[float] = mapped_column(Float, default=0.0)
    reb_pg: Mapped[float] = mapped_column(Float, default=0.0)
    ast_pg: Mapped[float] = mapped_column(Float, default=0.0)
    stl_pg: Mapped[float] = mapped_column(Float, default=0.0)
    blk_pg: Mapped[float] = mapped_column(Float, default=0.0)
    tov_pg: Mapped[float] = mapped_column(Float, default=0.0)
    tpm_pg: Mapped[float] = mapped_column(Float, default=0.0)
    fg_pct: Mapped[float] = mapped_column(Float, default=0.0)
    ft_pct: Mapped[float] = mapped_column(Float, default=0.0)
    fg_att_pg: Mapped[float] = mapped_column(Float, default=0.0)
    ft_att_pg: Mapped[float] = mapped_column(Float, default=0.0)

    fantasy_ppg: Mapped[float] = mapped_column(Float, default=0.0)
    projected_total: Mapped[float] = mapped_column(Float, default=0.0)

    player: Mapped["Player"] = relationship(back_populates="projections")
