"""
Tests for auth endpoints: register, login, me, rate limiting.

Uses in-memory SQLite (configured in conftest.py) — no real Postgres needed.
"""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest_asyncio.fixture(scope="module")
async def client(create_tables):
    """AsyncClient pointed at the real FastAPI app (SQLite-backed)."""
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_register_success(client):
    r = await client.post("/auth/register", json={
        "email": "alice@example.com",
        "username": "alice",
        "password": "password123",
    })
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["email"] == "alice@example.com"
    assert data["username"] == "alice"
    assert data["yahoo_linked"] is False


@pytest.mark.asyncio
async def test_register_duplicate_email(client):
    r = await client.post("/auth/register", json={
        "email": "alice@example.com",
        "username": "alice2",
        "password": "password123",
    })
    assert r.status_code == 400
    assert "email" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_register_duplicate_username(client):
    r = await client.post("/auth/register", json={
        "email": "alice2@example.com",
        "username": "alice",
        "password": "password123",
    })
    assert r.status_code == 400
    assert "username" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_register_short_password(client):
    r = await client.post("/auth/register", json={
        "email": "bob@example.com",
        "username": "bob",
        "password": "short",
    })
    assert r.status_code == 422  # pydantic validation


@pytest.mark.asyncio
async def test_register_short_username(client):
    r = await client.post("/auth/register", json={
        "email": "bob@example.com",
        "username": "bo",
        "password": "password123",
    })
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_login_success(client):
    r = await client.post("/auth/login", json={
        "email": "alice@example.com",
        "password": "password123",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password(client):
    r = await client.post("/auth/login", json={
        "email": "alice@example.com",
        "password": "wrongpassword",
    })
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_email(client):
    r = await client.post("/auth/login", json={
        "email": "nobody@example.com",
        "password": "password123",
    })
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Protected /auth/me
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_me_requires_auth(client):
    r = await client.get("/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_with_valid_token(client):
    login = await client.post("/auth/login", json={
        "email": "alice@example.com",
        "password": "password123",
    })
    token = login.json()["access_token"]

    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "alice@example.com"


@pytest.mark.asyncio
async def test_me_with_bad_token(client):
    r = await client.get("/auth/me", headers={"Authorization": "Bearer notavalidtoken"})
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_login_rate_limit(client):
    """11 rapid login attempts from the same IP should trigger a 429."""
    statuses = []
    for i in range(12):
        r = await client.post("/auth/login", json={
            "email": f"spam{i}@example.com",
            "password": "doesntmatter",
        })
        statuses.append(r.status_code)

    assert 429 in statuses, f"Expected a 429 but got: {statuses}"


@pytest.mark.asyncio
async def test_register_rate_limit(client):
    """7 rapid register attempts should trigger a 429 (limit is 5/min)."""
    statuses = []
    for i in range(7):
        r = await client.post("/auth/register", json={
            "email": f"ratelimit{i}@example.com",
            "username": f"ratelimituser{i}",
            "password": "password123",
        })
        statuses.append(r.status_code)

    assert 429 in statuses, f"Expected a 429 but got: {statuses}"
