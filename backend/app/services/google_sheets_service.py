"""Reading Google Sheets.

Two access modes:
- service_account: Google Sheets API v4 with a service account (sheet shared
  with the service account's email). Supports tab discovery.
- public_link: CSV export of a sheet shared as "Anyone with the link".
  Needs the tab's gid; no tab discovery.

The mode is chosen per tab: ``mapping.access_mode`` = "public_link" forces CSV
export; otherwise the service account is used when it is configured.
"""

from __future__ import annotations

import csv
import io
import time
from typing import Any
from urllib.parse import quote

import jwt

from ..core.config import get_settings
from ..core.supabase import http

SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"

_token: tuple[float, str] | None = None


class SheetReadError(Exception):
    pass


async def _access_token() -> str:
    global _token
    if _token and _token[0] > time.time() + 60:
        return _token[1]
    s = get_settings()
    if not s.has_google_service_account:
        raise SheetReadError("Google service account is not configured (GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY)")
    now = int(time.time())
    assertion = jwt.encode(
        {"iss": s.google_client_email, "scope": SCOPE, "aud": TOKEN_URL, "iat": now, "exp": now + 3600},
        s.google_private_key,
        algorithm="RS256",
    )
    resp = await http().post(TOKEN_URL, data={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion,
    })
    if resp.status_code != 200:
        raise SheetReadError(f"Google authentication failed: {resp.text[:200]}")
    body = resp.json()
    _token = (time.time() + int(body.get("expires_in", 3600)), body["access_token"])
    return _token[1]


async def discover_tabs(spreadsheet_id: str) -> list[dict[str, Any]]:
    """List tabs of a spreadsheet (service account only)."""
    token = await _access_token()
    resp = await http().get(
        f"{SHEETS_API}/{spreadsheet_id}",
        params={"fields": "properties.title,sheets.properties(sheetId,title,index,hidden)"},
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.status_code != 200:
        raise SheetReadError(_google_error(resp, spreadsheet_id))
    return [s["properties"] for s in resp.json().get("sheets", [])]


async def read_tab(spreadsheet_id: str, tab_name: str, gid: int | None, access_mode: str | None) -> list[list[str]]:
    s = get_settings()
    use_public = access_mode == "public_link" or not s.has_google_service_account
    if use_public:
        if gid is None:
            raise SheetReadError(
                f"Tab '{tab_name}' has no gid. Add the gid in the Sync Center or configure a Google service account."
            )
        return await _read_public_csv(spreadsheet_id, gid)
    token = await _access_token()
    rng = quote(f"'{tab_name.replace(chr(39), chr(39) * 2)}'", safe="")
    resp = await http().get(
        f"{SHEETS_API}/{spreadsheet_id}/values/{rng}",
        params={"valueRenderOption": "FORMATTED_VALUE", "majorDimension": "ROWS"},
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.status_code != 200:
        raise SheetReadError(_google_error(resp, spreadsheet_id))
    return resp.json().get("values", [])


async def _read_public_csv(spreadsheet_id: str, gid: int) -> list[list[str]]:
    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export"
    resp = await http().get(url, params={"format": "csv", "gid": str(gid)}, follow_redirects=True)
    ctype = resp.headers.get("content-type", "")
    if resp.status_code != 200 or "text/csv" not in ctype:
        raise SheetReadError(
            "The sheet is not readable through its public link. Share it as 'Anyone with the link' "
            "or configure a Google service account."
        )
    text = resp.content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    # CSV export pads every row to the same width; trim trailing empty cells.
    trimmed = []
    for row in rows:
        while row and row[-1] == "":
            row = row[:-1]
        trimmed.append(row)
    while trimmed and not trimmed[-1]:
        trimmed.pop()
    return trimmed


def _google_error(resp, spreadsheet_id: str) -> str:
    try:
        msg = resp.json().get("error", {}).get("message", resp.text[:200])
    except ValueError:
        msg = resp.text[:200]
    if resp.status_code in (403, 404):
        email = get_settings().google_client_email
        return f"No access to spreadsheet {spreadsheet_id}. Share it with {email} (Viewer). Google said: {msg}"
    return f"Google Sheets error {resp.status_code}: {msg}"
