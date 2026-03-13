"""
Yahoo OAuth 2.0 flow — one-time authorization to obtain a refresh token.

Usage:
  1. Visit GET /auth/yahoo  (in your browser, via Railway URL)
  2. Authorize the app on Yahoo's login page
  3. You land on /auth/yahoo/callback which displays your YAHOO_REFRESH_TOKEN
  4. Copy it into your Railway environment variables

Required env vars before starting:
  YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET
  YAHOO_REDIRECT_URI  (e.g. https://your-app.railway.app/auth/yahoo/callback)
"""

import os
import urllib.parse

import httpx
from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse

router = APIRouter(prefix="/auth", tags=["auth"])

YAHOO_AUTH_URL  = "https://api.login.yahoo.com/oauth2/request_auth"
YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"


def _creds() -> tuple[str, str, str]:
    client_id     = os.getenv("YAHOO_CLIENT_ID", "")
    client_secret = os.getenv("YAHOO_CLIENT_SECRET", "")
    redirect_uri  = os.getenv("YAHOO_REDIRECT_URI", "")
    return client_id, client_secret, redirect_uri


@router.get("/yahoo", include_in_schema=True)
async def yahoo_auth_start():
    """Redirect browser to Yahoo OAuth authorization page."""
    client_id, _, redirect_uri = _creds()

    if not client_id:
        return HTMLResponse(
            "<h2>Error</h2><p>YAHOO_CLIENT_ID is not set in environment variables.</p>",
            status_code=500,
        )
    if not redirect_uri:
        return HTMLResponse(
            "<h2>Error</h2><p>YAHOO_REDIRECT_URI is not set. "
            "Set it to https://your-app.railway.app/auth/yahoo/callback</p>",
            status_code=500,
        )

    params = {
        "client_id":     client_id,
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "scope":         "openid fspt-r",
    }
    url = f"{YAHOO_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return RedirectResponse(url)


@router.get("/yahoo/callback", include_in_schema=True)
async def yahoo_auth_callback(code: str = "", error: str = ""):
    """
    Yahoo redirects here after the user authorizes (or denies) the app.
    Exchanges the authorization code for tokens and displays the refresh token.
    """
    if error:
        return HTMLResponse(
            f"<h2>Authorization denied</h2><p>{error}</p>",
            status_code=400,
        )
    if not code:
        return HTMLResponse(
            "<h2>Error</h2><p>No authorization code received from Yahoo.</p>",
            status_code=400,
        )

    client_id, client_secret, redirect_uri = _creds()

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

    html = f"""
<!DOCTYPE html>
<html>
<head>
  <title>Yahoo Authorization Complete</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; }}
    h1   {{ color: #4a0080; }}
    .box {{ background: #f5f0ff; border: 1px solid #d0b8f0; border-radius: 8px;
             padding: 16px; margin: 16px 0; word-break: break-all; font-family: monospace; font-size: 13px; }}
    .step {{ background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 12px 0; }}
    h3   {{ margin-top: 0; }}
  </style>
</head>
<body>
  <h1>✓ Yahoo Authorization Successful</h1>
  <p>Copy the <strong>Refresh Token</strong> below and add it to your Railway environment variables.</p>

  <div class="step">
    <h3>YAHOO_REFRESH_TOKEN</h3>
    <div class="box">{refresh_token}</div>
  </div>

  <div class="step">
    <h3>What to do next</h3>
    <ol>
      <li>Go to your <strong>Railway project → your backend service → Variables</strong></li>
      <li>Add a new variable: <code>YAHOO_REFRESH_TOKEN</code> = the token above</li>
      <li>Railway will redeploy automatically</li>
      <li>Come back to the app and tap <strong>Sync</strong> on the Dashboard</li>
    </ol>
  </div>

  <details style="margin-top:20px">
    <summary style="cursor:pointer; color:#888">Access token (not needed)</summary>
    <div class="box">{access_token}</div>
  </details>
</body>
</html>
"""
    return HTMLResponse(html)
