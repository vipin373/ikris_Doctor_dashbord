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
    # FDA module integrations (server-side only; never sent to the browser)
    fda_api_base_url: str = "https://api.fda.gov"
    fda_api_key: str = ""
    kegg_api_base_url: str = ""
    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-sonnet-4.5"
    cunnekt_api_key: str = ""
    cunnekt_base_url: str = "https://app.cunnekt.com/restapi/v1/whatsapp/"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    email_from: str = ""

    @property
    def has_service_role(self) -> bool:
        return bool(self.supabase_service_role_key)

    @property
    def missing_email_config(self) -> list[str]:
        return [n for n, v in (("SMTP_HOST", self.smtp_host), ("SMTP_USER", self.smtp_user),
                               ("SMTP_PASSWORD", self.smtp_password), ("EMAIL_FROM", self.email_from)) if not v]

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
        fda_api_base_url=_env("FDA_API_BASE_URL", default="https://api.fda.gov").rstrip("/"),
        fda_api_key=_env("FDA_API_KEY"),
        kegg_api_base_url=_env("KEGG_API_BASE_URL").rstrip("/"),
        openrouter_api_key=_env("OPENROUTER_API_KEY"),
        openrouter_model=_env("OPENROUTER_MODEL", default="anthropic/claude-sonnet-4.5"),
        cunnekt_api_key=_env("CUNNEKT_API_KEY"),
        cunnekt_base_url=_env("CUNNEKT_BASE_URL", default="https://app.cunnekt.com/restapi/v1/whatsapp/").rstrip("/") + "/",
        smtp_host=_env("SMTP_HOST"),
        smtp_port=int(_env("SMTP_PORT", default="587") or 587),
        smtp_user=_env("SMTP_USER"),
        smtp_password=_env("SMTP_PASSWORD"),
        email_from=_env("EMAIL_FROM", "SMTP_USER"),
    )
