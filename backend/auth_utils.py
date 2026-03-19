"""
JWT creation/verification, password hashing, and FastAPI auth dependencies.
"""

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db

SECRET_KEY: str = os.getenv(
    "JWT_SECRET",
    "change-me-in-production-use-a-long-random-string-here",
)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60   # 1 hour
REFRESH_TOKEN_EXPIRE_DAYS = 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# Access token
# ---------------------------------------------------------------------------

def create_access_token(user_id: int, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": str(user_id), "email": email, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


# ---------------------------------------------------------------------------
# Refresh token
# ---------------------------------------------------------------------------

def generate_refresh_token() -> tuple[str, str]:
    """Return (raw_token, sha256_hash). Send raw to client; store hash in DB."""
    raw = secrets.token_urlsafe(64)
    return raw, hashlib.sha256(raw.encode()).hexdigest()


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# OAuth state token (short-lived, used to carry user_id through Yahoo OAuth)
# ---------------------------------------------------------------------------

def create_state_token(user_id: int) -> str:
    """10-minute token embedded in Yahoo OAuth state param."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=10)
    return jwt.encode(
        {"sub": str(user_id), "purpose": "yahoo_oauth_state", "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_state_token(state: str) -> int:
    """Decode and validate a state token. Returns user_id or raises 400."""
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose") != "yahoo_oauth_state":
            raise ValueError("wrong purpose")
        return int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
):
    """Decode Bearer JWT and return the User ORM object, or raise 401."""
    from .models import User  # local import avoids circular dependency

    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id_str: str | None = payload.get("sub")
        if not user_id_str:
            raise exc
    except JWTError:
        raise exc

    user = (
        await db.execute(select(User).where(User.id == int(user_id_str)))
    ).scalar_one_or_none()

    if user is None or not user.is_active:
        raise exc

    return user
