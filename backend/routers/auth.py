"""
Yahoo OAuth 2.0 flow — links a Yahoo account to the logged-in user's profile.

Usage:
  1. Client calls GET /auth/yahoo (with Bearer token) → receives a redirect URL
  2. User opens the redirect URL in a browser, authorizes on Yahoo's page
  3. Yahoo redirects to /auth/yahoo/callback?code=...&state=<signed_user_token>
  4. Callback stores the Yahoo refresh token in the User row
  5. Returns success HTML; app can now call POST /ingest/yahoo-league

Required env vars (app-level, shared across all users):
  YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REDIRECT_URI
"""

import os
import urllib.parse
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth_utils import create_state_token, decode_state_token, get_current_user
from ..crypto import encrypt_field
from ..database import get_db
from ..ingestion.yahoo import get_user_league_id
from ..models import User

router = APIRouter(prefix="/auth", tags=["auth"])

YAHOO_AUTH_URL  = "https://api.login.yahoo.com/oauth2/request_auth"
YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"


def _app_creds() -> tuple[str, str, str]:
    """App-level Yahoo credentials (shared across all users)."""
    client_id     = os.getenv("YAHOO_CLIENT_ID", "")
    client_secret = os.getenv("YAHOO_CLIENT_SECRET", "")
    redirect_uri  = os.getenv("YAHOO_REDIRECT_URI", "")
    return client_id, client_secret, redirect_uri


@router.get("/yahoo/link", include_in_schema=True)
async def yahoo_link_start(current_user: User = Depends(get_current_user)):
    """
    Return the Yahoo OAuth authorization URL for the authenticated user.
    The frontend should open this URL in a browser/webview.
    """
    client_id, _, redirect_uri = _app_creds()

    if not client_id:
        raise HTTPException(status_code=500, detail="YAHOO_CLIENT_ID is not configured.")
    if not redirect_uri:
        raise HTTPException(
            status_code=500,
            detail="YAHOO_REDIRECT_URI is not configured.",
        )

    state = create_state_token(current_user.id)
    params = {
        "client_id":     client_id,
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "scope":         "openid fspt-r",
        "state":         state,
    }
    url = f"{YAHOO_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return JSONResponse({"auth_url": url})


@router.get("/yahoo/callback", include_in_schema=True)
async def yahoo_auth_callback(
    code: str = "",
    state: str = "",
    error: str = "",
    db: AsyncSession = Depends(get_db),
):
    """
    Yahoo redirects here after authorization.
    Exchanges the code for tokens and saves them to the user's profile.
    """
    if error:
        return HTMLResponse(
            f"<h2>Authorization denied</h2><p>{error}</p>",
            status_code=400,
        )
    if not code or not state:
        return HTMLResponse(
            "<h2>Error</h2><p>Missing code or state parameter.</p>",
            status_code=400,
        )

    # Verify state and get user_id
    try:
        user_id = decode_state_token(state)
    except HTTPException:
        return HTMLResponse(
            "<h2>Error</h2><p>Invalid or expired authorization state. Please try linking again.</p>",
            status_code=400,
        )

    from sqlalchemy import select
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        return HTMLResponse("<h2>Error</h2><p>User not found.</p>", status_code=404)

    client_id, client_secret, redirect_uri = _app_creds()

    async with httpx.AsyncClient(timeout=30) as c:
        resp = await c.post(
            YAHOO_TOKEN_URL,
            data={
                "grant_type":   "authorization_code",
                "code":         code,
                "redirect_uri": redirect_uri,
            },
            auth=(client_id, client_secret),
        )

    if resp.status_code != 200:
        return HTMLResponse(
            f"<h2>Token exchange failed</h2><pre>{resp.text[:500]}</pre>",
            status_code=502,
        )

    tokens = resp.json()
    refresh_token = tokens.get("refresh_token", "")
    access_token  = tokens.get("access_token", "")
    expires_in    = int(tokens.get("expires_in", 3600))

    # Save tokens to the user's profile (encrypted at rest)
    user.yahoo_refresh_token   = encrypt_field(refresh_token)
    user.yahoo_access_token    = encrypt_field(access_token)
    user.yahoo_token_expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    )

    # Auto-detect the user's NBA fantasy league ID
    if not user.yahoo_league_id:
        detected_league_id = await get_user_league_id(access_token)
        if detected_league_id:
            user.yahoo_league_id = detected_league_id
            print(f"[yahoo] Auto-detected league_id={detected_league_id} for user {user.id}")

    await db.commit()

    return HTMLResponse("""
<!DOCTYPE html>
<html>
<head>
  <title>Yahoo Linked</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 60px auto; text-align: center; }
    h1 { color: #4a0080; }
    p  { color: #555; }
  </style>
</head>
<body>
  <h1>&#10003; Yahoo Account Linked</h1>
  <p>Your Yahoo Fantasy account has been linked successfully.</p>
  <p>You can close this window and return to the app.</p>
  <p>Next step: go to <strong>Settings &rarr; Sync Yahoo League</strong> to import your league data.</p>
</body>
</html>
""")
