"""
Basketball Monster automated download.

Logs into basketballmonster.com and downloads the projections Excel file.
Requires env vars: BBM_EMAIL, BBM_PASSWORD
Optional env var: BBM_DOWNLOAD_URL (defaults to the standard rankings export)

To find the correct download URL:
  1. Log into basketballmonster.com in your browser
  2. Right-click the "Download" / "Export" button on the Rankings/Projections page
  3. Copy the link address and set it as BBM_DOWNLOAD_URL
"""

import os
import re

import httpx

# ── Constants ──────────────────────────────────────────────────────────────────

_LOGIN_URL = "https://www.basketballmonster.com/users/sign_in"

# Best-guess default — override with BBM_DOWNLOAD_URL env var if it differs
_DEFAULT_DOWNLOAD_URL = "https://www.basketballmonster.com/rankings/download.xlsx"

_EXCEL_CONTENT_TYPES = {
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
}

# ── Helpers ───────────────────────────────────────────────────────────────────


def _extract_csrf(html: str) -> str:
    """Extract Rails CSRF authenticity_token from a page's HTML."""
    # Hidden input field (login form)
    m = re.search(r'name=["\']authenticity_token["\']\s+value=["\']([^"\']+)["\']', html)
    if m:
        return m.group(1)
    m = re.search(r'value=["\']([^"\']+)["\']\s+name=["\']authenticity_token["\']', html)
    if m:
        return m.group(1)
    # Meta tag (some Rails versions)
    m = re.search(r'<meta\s+name=["\']csrf-token["\']\s+content=["\']([^"\']+)["\']', html)
    if m:
        return m.group(1)
    raise ValueError(
        "Could not find CSRF token on the BBM login page. "
        "The site layout may have changed — check _LOGIN_URL."
    )


# ── Public API ────────────────────────────────────────────────────────────────


def download_bball_monster_projections(email: str, password: str) -> bytes:
    """
    Log into Basketball Monster and return the projections Excel file as bytes.

    Raises:
        ValueError: on login failure, unexpected response, or missing CSRF token.
        httpx.HTTPStatusError: on HTTP errors during login/download.
    """
    download_url = os.getenv("BBM_DOWNLOAD_URL", _DEFAULT_DOWNLOAD_URL)

    with httpx.Client(follow_redirects=True, timeout=30) as client:
        # ── Step 1: GET login page to capture CSRF token ──────────────────────
        resp = client.get(_LOGIN_URL)
        resp.raise_for_status()
        csrf = _extract_csrf(resp.text)

        # ── Step 2: POST credentials ──────────────────────────────────────────
        resp = client.post(
            _LOGIN_URL,
            data={
                "authenticity_token": csrf,
                "user[email]": email,
                "user[password]": password,
                "commit": "Sign in",
            },
        )
        resp.raise_for_status()

        # Detect login failure (still on sign_in page or error message present)
        final_url = str(resp.url)
        body_lower = resp.text.lower()
        if "sign_in" in final_url or any(
            phrase in body_lower
            for phrase in ("invalid email", "invalid password", "incorrect", "sign in")
        ):
            raise ValueError(
                "BBM login failed — please check BBM_EMAIL and BBM_PASSWORD. "
                f"(Landed on: {final_url})"
            )

        # ── Step 3: Download projections ──────────────────────────────────────
        resp = client.get(download_url)
        resp.raise_for_status()

        content_type = resp.headers.get("content-type", "").split(";")[0].strip()
        if content_type not in _EXCEL_CONTENT_TYPES:
            raise ValueError(
                f"Expected an Excel file but got Content-Type: '{content_type}'. "
                f"Verify BBM_DOWNLOAD_URL (currently: {download_url}). "
                "Log into BBM in your browser, find the Export/Download button, "
                "right-click → Copy Link, then set that URL as BBM_DOWNLOAD_URL."
            )

        return resp.content
