"""Minimal async client for Supabase PostgREST and Auth.

Two modes:
- user mode: requests carry the caller's JWT, so Row Level Security applies.
- service mode: requests use the service role key (server-side only) and
  bypass RLS. Used for sync, user invitations and audit logging.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from .config import get_settings


class SupabaseError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class ServiceUnavailable(Exception):
    pass


_client: httpx.AsyncClient | None = None


def http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
    return _client


class PostgREST:
    def __init__(self, token: str | None = None, service: bool = False):
        s = get_settings()
        if not s.supabase_url or not s.supabase_anon_key:
            raise ServiceUnavailable("Supabase URL / anon key are not configured")
        if service and not s.has_service_role:
            raise ServiceUnavailable("SUPABASE_SERVICE_ROLE_KEY is not configured on the server")
        self.base = f"{s.supabase_url}/rest/v1"
        key = s.supabase_service_role_key if service else s.supabase_anon_key
        bearer = s.supabase_service_role_key if service else (token or s.supabase_anon_key)
        self.headers = {"apikey": key, "Authorization": f"Bearer {bearer}"}

    @classmethod
    def service(cls) -> "PostgREST":
        return cls(service=True)

    @staticmethod
    def _raise(resp: httpx.Response) -> None:
        if resp.status_code >= 400:
            try:
                body = resp.json()
                msg = body.get("message") or body.get("msg") or json.dumps(body)
            except ValueError:
                msg = resp.text
            raise SupabaseError(resp.status_code, msg)

    async def select(
        self,
        table: str,
        params: list[tuple[str, str]] | dict[str, str],
        count: bool = False,
        offset: int | None = None,
        limit: int | None = None,
    ) -> tuple[list[dict[str, Any]], int | None]:
        headers = dict(self.headers)
        if count:
            headers["Prefer"] = "count=exact"
        p = list(params.items()) if isinstance(params, dict) else list(params)
        if offset is not None:
            p.append(("offset", str(offset)))
        if limit is not None:
            p.append(("limit", str(limit)))
        resp = await http().get(f"{self.base}/{table}", params=p, headers=headers)
        self._raise(resp)
        total = None
        if count:
            rng = resp.headers.get("content-range", "")
            if "/" in rng and rng.split("/")[1] != "*":
                total = int(rng.split("/")[1])
        return resp.json(), total

    async def select_all(self, table: str, params: list[tuple[str, str]], page: int = 1000) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            batch, _ = await self.select(table, params, offset=offset, limit=page)
            rows.extend(batch)
            if len(batch) < page:
                return rows
            offset += page

    async def rpc(self, fn: str, payload: dict[str, Any] | None = None) -> Any:
        resp = await http().post(f"{self.base}/rpc/{fn}", json=payload or {}, headers=self.headers)
        self._raise(resp)
        return resp.json()

    async def insert(
        self,
        table: str,
        rows: list[dict[str, Any]] | dict[str, Any],
        on_conflict: str | None = None,
        resolution: str | None = None,  # merge-duplicates | ignore-duplicates
        returning: str | None = None,
    ) -> list[dict[str, Any]]:
        prefer = ["return=representation" if returning else "return=minimal"]
        if resolution:
            prefer.append(f"resolution={resolution}")
        headers = {**self.headers, "Prefer": ",".join(prefer)}
        params: list[tuple[str, str]] = []
        if on_conflict:
            params.append(("on_conflict", on_conflict))
        if returning:
            params.append(("select", returning))
        resp = await http().post(f"{self.base}/{table}", params=params, json=rows, headers=headers)
        self._raise(resp)
        return resp.json() if returning else []

    async def update(
        self, table: str, filters: list[tuple[str, str]], data: dict[str, Any], returning: str | None = None
    ) -> list[dict[str, Any]]:
        headers = {**self.headers, "Prefer": "return=representation" if returning else "return=minimal"}
        params = list(filters)
        if returning:
            params.append(("select", returning))
        resp = await http().patch(f"{self.base}/{table}", params=params, json=data, headers=headers)
        self._raise(resp)
        return resp.json() if returning else []


    async def delete(self, table: str, filters: list[tuple[str, str]]) -> None:
        resp = await http().delete(f"{self.base}/{table}", params=filters, headers={**self.headers, "Prefer": "return=minimal"})
        self._raise(resp)


async def auth_get_user(token: str) -> dict[str, Any] | None:
    s = get_settings()
    resp = await http().get(
        f"{s.supabase_url}/auth/v1/user",
        headers={"apikey": s.supabase_anon_key, "Authorization": f"Bearer {token}"},
    )
    if resp.status_code != 200:
        return None
    return resp.json()


async def auth_invite_user(email: str, name: str | None, redirect_to: str | None) -> dict[str, Any]:
    s = get_settings()
    if not s.has_service_role:
        raise ServiceUnavailable("SUPABASE_SERVICE_ROLE_KEY is not configured on the server")
    params = {"redirect_to": redirect_to} if redirect_to else None
    resp = await http().post(
        f"{s.supabase_url}/auth/v1/invite",
        params=params,
        json={"email": email, "data": {"name": name} if name else {}},
        headers={"apikey": s.supabase_service_role_key, "Authorization": f"Bearer {s.supabase_service_role_key}"},
    )
    PostgREST._raise(resp)
    return resp.json()
