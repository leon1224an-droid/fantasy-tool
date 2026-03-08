"""
Alembic env.py — configured for SQLAlchemy async engine.

Run from the project root (fantasy-tool/):
  alembic revision --autogenerate -m "initial"
  alembic upgrade head
"""

import asyncio
import os
import sys
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Make `backend` importable when running alembic from the project root.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# Import all models so autogenerate can detect them.
from backend.models import Base  # noqa: E402  (must come after sys.path fix)

# ---------------------------------------------------------------------------
# Alembic config object — provides access to alembic.ini values.
# ---------------------------------------------------------------------------
config = context.config

# Override sqlalchemy.url from environment (takes priority over alembic.ini).
db_url = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/fantasy_tool",
)
# Alembic needs the sync dialect for offline mode; swap asyncpg → psycopg2.
sync_url = db_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
config.set_main_option("sqlalchemy.url", sync_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


# ---------------------------------------------------------------------------
# Offline migrations (generate SQL script without a live DB connection)
# ---------------------------------------------------------------------------
def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------------------------------
# Online migrations (against a live DB via async engine)
# ---------------------------------------------------------------------------
def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    # Use async engine but NullPool so connections aren't pooled during migration.
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        # Override with the async URL for the actual connection.
        url=db_url,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
