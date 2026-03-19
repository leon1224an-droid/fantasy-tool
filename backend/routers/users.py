"""
User account endpoints:
  POST /auth/register   — create a new account
  POST /auth/login      — email + password → access + refresh tokens
  POST /auth/refresh    — rotate refresh token → new access + refresh tokens
  POST /auth/logout     — revoke the current refresh token
  GET  /auth/me         — current user profile
  PATCH /auth/me        — update email / username / password
  PATCH /auth/me/yahoo  — save Yahoo league credentials (league_id)
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..limiter import limiter
from ..auth_utils import (
    REFRESH_TOKEN_EXPIRE_DAYS,
    create_access_token,
    generate_refresh_token,
    get_current_user,
    get_password_hash,
    hash_refresh_token,
    verify_password,
)
from ..database import get_db
from ..models import RefreshToken, User

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Username must be at least 3 characters.")
        if len(v) > 50:
            raise ValueError("Username must be at most 50 characters.")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters.")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    is_active: bool
    is_admin: bool
    created_at: str
    yahoo_league_id: str | None
    yahoo_linked: bool  # True if user has a stored refresh token
    nba_projections_fetched_at: str | None  # ISO timestamp or None


class UpdateProfileRequest(BaseModel):
    email: EmailStr | None = None
    username: str | None = None
    password: str | None = None
    current_password: str | None = None  # required when changing password


class UpdateYahooRequest(BaseModel):
    yahoo_league_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        is_active=user.is_active,
        is_admin=user.is_admin,
        created_at=user.created_at.isoformat(),
        yahoo_league_id=user.yahoo_league_id,
        yahoo_linked=bool(user.yahoo_refresh_token),
        nba_projections_fetched_at=(
            user.nba_projections_fetched_at.isoformat()
            if user.nba_projections_fetched_at else None
        ),
    )


def _issue_tokens(user: User, response: Response) -> TokenResponse:
    """Create access + refresh tokens. Sends refresh token as HttpOnly cookie."""
    access = create_access_token(user.id, user.email)
    raw_refresh, hashed_refresh = generate_refresh_token()

    # Attach refresh token as HttpOnly cookie (30 days)
    response.set_cookie(
        key="refresh_token",
        value=raw_refresh,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth/refresh",
    )
    return TokenResponse(access_token=access), hashed_refresh


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Create a new user account."""
    email_conflict = (
        await db.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if email_conflict:
        raise HTTPException(status_code=400, detail="An account with that email already exists.")

    username_conflict = (
        await db.execute(select(User).where(User.username == body.username))
    ).scalar_one_or_none()
    if username_conflict:
        raise HTTPException(status_code=400, detail="That username is already taken.")

    user = User(
        email=body.email,
        username=body.username,
        hashed_password=get_password_hash(body.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_response(user)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate with email + password. Returns access token; sets refresh cookie."""
    user = (
        await db.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled.")

    access = create_access_token(user.id, user.email)
    raw_refresh, hashed_refresh = generate_refresh_token()

    expires = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    db.add(RefreshToken(user_id=user.id, token_hash=hashed_refresh, expires_at=expires))
    await db.commit()

    response.set_cookie(
        key="refresh_token",
        value=raw_refresh,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth/refresh",
    )
    return TokenResponse(access_token=access)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    Exchange a valid refresh token (from cookie) for a new access + refresh token pair.
    Old refresh token is revoked (rotation).
    """
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token provided.")

    token_hash = hash_refresh_token(refresh_token)
    stored = (
        await db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked == False,
            )
        )
    ).scalar_one_or_none()

    if not stored or stored.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token is invalid or expired.")

    # Revoke the used token
    stored.revoked = True
    await db.flush()

    user = (
        await db.execute(select(User).where(User.id == stored.user_id))
    ).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User account not found or disabled.")

    # Issue new tokens
    access = create_access_token(user.id, user.email)
    raw_refresh, hashed_refresh = generate_refresh_token()
    expires = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    db.add(RefreshToken(user_id=user.id, token_hash=hashed_refresh, expires_at=expires))
    await db.commit()

    response.set_cookie(
        key="refresh_token",
        value=raw_refresh,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth/refresh",
    )
    return TokenResponse(access_token=access)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke the refresh token and clear the cookie."""
    if refresh_token:
        token_hash = hash_refresh_token(refresh_token)
        stored = (
            await db.execute(
                select(RefreshToken).where(RefreshToken.token_hash == token_hash)
            )
        ).scalar_one_or_none()
        if stored and stored.user_id == current_user.id:
            stored.revoked = True
            await db.commit()

    response.delete_cookie(key="refresh_token", path="/auth/refresh")


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    return _user_response(current_user)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UpdateProfileRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update email, username, or password."""
    if body.password:
        if not body.current_password:
            raise HTTPException(
                status_code=400, detail="current_password is required to set a new password."
            )
        if not verify_password(body.current_password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail="Current password is incorrect.")
        current_user.hashed_password = get_password_hash(body.password)

    if body.email and body.email != current_user.email:
        conflict = (
            await db.execute(select(User).where(User.email == body.email))
        ).scalar_one_or_none()
        if conflict:
            raise HTTPException(status_code=400, detail="Email already in use.")
        current_user.email = body.email

    if body.username and body.username != current_user.username:
        conflict = (
            await db.execute(select(User).where(User.username == body.username))
        ).scalar_one_or_none()
        if conflict:
            raise HTTPException(status_code=400, detail="Username already taken.")
        current_user.username = body.username

    await db.commit()
    await db.refresh(current_user)
    return _user_response(current_user)


@router.patch("/me/yahoo", response_model=UserResponse)
async def update_yahoo_settings(
    body: UpdateYahooRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save the user's Yahoo Fantasy league ID."""
    current_user.yahoo_league_id = body.yahoo_league_id.strip()
    await db.commit()
    await db.refresh(current_user)
    return _user_response(current_user)


@router.delete("/me/yahoo", response_model=UserResponse)
async def unlink_yahoo(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove Yahoo credentials from this account."""
    current_user.yahoo_refresh_token = None
    current_user.yahoo_access_token = None
    current_user.yahoo_token_expires_at = None
    current_user.yahoo_league_id = None
    await db.commit()
    await db.refresh(current_user)
    return _user_response(current_user)
