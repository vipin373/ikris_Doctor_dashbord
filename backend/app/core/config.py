from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value.strip()
    return default


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    google_client_email: str
    google_private_key: str
    google_project_id: str
    cron_secret: str
    app_url: str
    allowed_origins: list[str] = field(default_factory=list)
    rate_limit_per_minute: int = 240

    @property
    def has_service_role(self) -> bool:
        return bool(self.supabase_service_role_key)

    @property
    def has_google_service_account(self) -> bool:
        return bool(self.google_client_email and self.google_private_key)


@lru_cache
def get_settings() -> Settings:
    app_url = _env("APP_URL", "NEXT_PUBLIC_APP_URL")
    if not app_url and os.environ.get("VERCEL_PROJECT_PRODUCTION_URL"):
        app_url = "https://" + os.environ["VERCEL_PROJECT_PRODUCTION_URL"]
    origins = [o.strip() for o in _env("ALLOWED_ORIGINS").split(",") if o.strip()]
    if app_url and app_url not in origins:
        origins.append(app_url)
    return Settings(
        supabase_url=_env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").rstrip("/"),
        supabase_anon_key=_env("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        supabase_service_role_key=_env("SUPABASE_SERVICE_ROLE_KEY"),
        google_client_email=_env("GOOGLE_CLIENT_EMAIL"),
        # Private keys pasted into env vars usually carry literal "\n".
        google_private_key=_env("GOOGLE_PRIVATE_KEY").replace("\\n", "\n"),
        google_project_id=_env("GOOGLE_PROJECT_ID"),
        cron_secret=_env("CRON_SECRET"),
        app_url=app_url,
        allowed_origins=origins or ["http://localhost:3000"],
        rate_limit_per_minute=int(_env("RATE_LIMIT_PER_MINUTE", default="240")),
    )
