"""
Test configuration — uses the real Postgres DB in a separate schema
so tests don't touch production data and are fully cleaned up after.
"""

import os

# Point at real Postgres (same DB, isolated via schema created per test run)
os.environ["DATABASE_URL"] = (
    "postgresql+asyncpg://fantasy_user:fantasy123@localhost:5432/fantasy_tool"
)
os.environ.setdefault("JWT_SECRET", "test-secret-for-pytest-only")
os.environ.setdefault("FIELD_ENCRYPTION_KEY", "")

import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import backend.database as db_module
from backend.database import Base

# Use a separate engine for the test schema so we don't share state
_TEST_DB_URL = os.environ["DATABASE_URL"]
_test_engine = create_async_engine(_TEST_DB_URL, pool_size=3, max_overflow=5, pool_pre_ping=True)
_TestSession = async_sessionmaker(bind=_test_engine, expire_on_commit=False, autoflush=False, autocommit=False)

db_module.engine = _test_engine
db_module.AsyncSessionLocal = _TestSession


@pytest_asyncio.fixture(scope="session", autouse=True)
async def create_tables():
    """Create all tables once, clean up after the session."""
    import backend.models  # noqa: F401 — populate metadata
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Tear down: delete all rows added by tests (keep schema for speed)
    async with _test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())
