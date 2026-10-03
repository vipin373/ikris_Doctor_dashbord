"""Writing template edits back to Google Sheets.

Each spreadsheet gets a small Apps Script web app (the "editing bridge") that
the dashboard calls with a shared token. The script only changes the tabs it
lists in ALLOWED_TABS. See docs/GOOGLE_SHEETS.md.
"""

from __future__ import annotations

import re
import secrets
from typing import Any

from ..core.supabase import http

URL_RE = re.compile(r"^https://script\.google\.com/macros/s/[A-Za-z0-9_\-]+/exec$")


class BridgeError(Exception):
    pass


class BridgeNotConnected(Exception):
    pass


def new_token() -> str:
    return secrets.token_urlsafe(24)


def valid_url(url: str) -> bool:
    return bool(URL_RE.match(url.strip()))


async def call(url: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        resp = await http().post(url, json={**payload, "token": token}, follow_redirects=True, timeout=45.0)
    except Exception as exc:  # network errors
        raise BridgeError(f"Could not reach the Google Sheet editing link: {exc}") from exc
    try:
        data = resp.json()
    except ValueError:
        raise BridgeError(
            "The Google Sheet editing link did not answer correctly. Check that the Apps Script web app is "
            "deployed with 'Execute as: Me' and 'Who has access: Anyone', and that you pasted the /exec URL."
        )
    if not data.get("ok"):
        raise BridgeError(f"Google Sheet rejected the change: {data.get('error') or 'unknown error'}")
    return data


def _target(target: dict[str, Any] | None) -> tuple[str, str]:
    if not target or not target.get("bridge_url") or not target.get("bridge_token"):
        raise BridgeNotConnected(
            "Editing from the dashboard is not connected for this Google Sheet yet. "
            "An Admin can connect it in Google Sheets Sync Center → Edit from dashboard."
        )
    return target["bridge_url"], target["bridge_token"]


async def update_cells(target: dict[str, Any] | None, updates: list[dict[str, str]]) -> None:
    url, token = _target(target)
    await call(url, token, {"action": "update", "updates": updates})


async def append_row(target: dict[str, Any] | None, sheet: str, values: list[str]) -> int:
    url, token = _target(target)
    data = await call(url, token, {"action": "append", "sheet": sheet, "values": values})
    return int(data["row"])


async def delete_row(target: dict[str, Any] | None, sheet: str, row: int) -> None:
    url, token = _target(target)
    await call(url, token, {"action": "deleteRow", "sheet": sheet, "row": row})


def render_script(spreadsheet_id: str, name: str, token: str, tabs: list[str]) -> str:
    tabs_js = ", ".join("'" + t.replace("\\", "\\\\").replace("'", "\\'") + "'" for t in tabs)
    return f"""/**
 * IKRIS Doctor Connect - dashboard editing bridge for "{name}".
 * Lets the IKRIS dashboard update the template tabs listed in ALLOWED_TABS.
 * Nothing else in this spreadsheet can be changed through it.
 * Keep the token private.
 */
var IKRIS_TOKEN = '{token}';
var SPREADSHEET_ID = '{spreadsheet_id}';
var ALLOWED_TABS = [{tabs_js}];

function doPost(e) {{
  var res;
  try {{
    var req = JSON.parse(e.postData.contents);
    if (req.token !== IKRIS_TOKEN) throw new Error('Invalid token');
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var tab = function (name) {{
      if (ALLOWED_TABS.indexOf(name) === -1) throw new Error('Tab not allowed: ' + name);
      var sh = ss.getSheetByName(name);
      if (!sh) throw new Error('Tab not found: ' + name);
      return sh;
    }};
    var safe = function (v) {{
      v = v === null || v === undefined ? '' : String(v);
      return /^[=+\\-@]/.test(v) ? "'" + v : v;
    }};
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {{
      if (req.action === 'ping') {{
        res = {{ ok: true, name: ss.getName(), tabs: ALLOWED_TABS }};
      }} else if (req.action === 'update') {{
        req.updates.forEach(function (u) {{ tab(u.sheet).getRange(u.cell).setValue(safe(u.value)); }});
        res = {{ ok: true, updated: req.updates.length }};
      }} else if (req.action === 'append') {{
        var sh = tab(req.sheet);
        sh.appendRow(req.values.map(safe));
        res = {{ ok: true, row: sh.getLastRow() }};
      }} else if (req.action === 'deleteRow') {{
        if (!(req.row >= 2)) throw new Error('Cannot delete the header row');
        tab(req.sheet).deleteRow(req.row);
        res = {{ ok: true }};
      }} else {{
        throw new Error('Unknown action');
      }}
      SpreadsheetApp.flush();
    }} finally {{
      lock.releaseLock();
    }}
  }} catch (err) {{
    res = {{ ok: false, error: String((err && err.message) || err) }};
  }}
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}}
"""
