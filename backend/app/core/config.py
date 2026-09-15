"""
Central configuration for the Quote Comparison Tool backend.

All secrets are read from environment variables (or a local `.env` file).
Copy `.env.example` -> `.env` and fill in:

    OPENAI_API_KEY   -> your OpenAI key
    AZURE_ENDPOINT   -> your Azure AI Document Intelligence endpoint URL
    AZURE_KEY        -> your Azure AI Document Intelligence key

Secrets are typed as `SecretStr` so they can never leak through repr(),
logging, or error messages — use `.get_secret_value()` at the call site.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# .env lives at the repository root (one level above backend/), so the same
# file works no matter which directory the server or tests are run from.
ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    # ── LLM provider selection ───────────────────────────────────────────
    # "auto" uses OpenAI when its key is set, else the Claude API.
    # Pin explicitly with LLM_PROVIDER=openai|anthropic in .env.
    # "stub" is a deterministic, offline extractor (no keys, no network) for
    # reproducible E2E tests and keyless local demos — refused in production.
    llm_provider: Literal["auto", "openai", "anthropic", "stub"] = "auto"

    # ── OpenAI (Structured Output extraction) ────────────────────────────
    openai_api_key: SecretStr = SecretStr("")
    openai_model: str = "gpt-4o-2024-08-06"
    openai_timeout_seconds: float = 120.0
    openai_max_retries: int = 2

    # ── Claude API (Anthropic SDK, structured outputs) ───────────────────
    anthropic_api_key: SecretStr = SecretStr("")
    anthropic_model: str = "claude-haiku-4-5"
    anthropic_timeout_seconds: float = 120.0
    anthropic_max_retries: int = 2

    # ── Azure AI Document Intelligence (OCR fallback) ────────────────────
    azure_endpoint: str = ""
    azure_key: SecretStr = SecretStr("")

    # ── Digital-vs-scanned detection heuristics ──────────────────────────
    # A page with fewer extractable characters than this is treated as scanned.
    digital_min_chars_per_page: int = 150
    # If at least this fraction of pages look scanned, the whole document
    # is routed to Azure OCR.
    scanned_page_ratio: float = 0.4

    # ── Storage + authentication (BRD 2.9/2.10) ──────────────────────────
    # Relational project store (docs/DATABASE.md): a PostgreSQL URL in
    # production (Supabase's connection string works as-is); empty = a local
    # SQLite file under DATA_DIR for development and tests.
    database_url: str = ""
    # SQLite database + uploaded documents + generated exports live here.
    # Default: <repo>/data. Point DATA_DIR elsewhere (e.g. a mounted,
    # encrypted volume) in production.
    data_dir: str = ""
    # First user, seeded on startup when the users table is empty —
    # further users are added with `python -m app.manage`.
    admin_email: str = ""
    admin_password: SecretStr = SecretStr("")
    session_ttl_hours: int = 72
    # Log a session out after this much inactivity (0 disables). Absolute
    # expiry (session_ttl_hours) still applies on top.
    inactivity_timeout_minutes: int = 60
    # Lockout: after this many failed logins (per account AND per IP), block
    # further attempts for the cooldown.
    login_max_attempts: int = 5
    login_lockout_minutes: int = 15
    # Set COOKIE_SECURE=true behind HTTPS in production.
    cookie_secure: bool = False
    # Supabase Auth (the Next.js frontend in web/): the app signs in with
    # Supabase and sends its access token as `Authorization: Bearer`. Tokens
    # are verified locally — HS256 with SUPABASE_JWT_SECRET (the project's
    # legacy JWT secret) or, when that is empty, against the project's JWKS
    # (ES256/RS256) fetched from SUPABASE_URL. Both empty = disabled.
    supabase_url: str = ""
    supabase_jwt_secret: SecretStr = SecretStr("")
    supabase_jwt_audience: str = "authenticated"
    # Supabase Storage for retained documents (docs/DATABASE.md): the
    # service-role key is server-side only and never reaches the browser.
    # Empty = local files under DATA_DIR (development/tests).
    supabase_service_role_key: SecretStr = SecretStr("")
    supabase_storage_bucket: str = "documents"
    # Admin role (config endpoints): a Supabase user with app_metadata.role
    # = "admin" (web: `npm run users -- role <email> admin`), or any email
    # listed here (comma-separated) — also covers the classic cookie login.
    admin_emails: str = ""
    # Data retention (BRD 2.11): hard-delete projects untouched for longer
    # than this many days. 0 = disabled (keep forever) — the period is the
    # client's decision, so nothing is deleted until they set it.
    retention_days: int = 0

    # ── Backups (durability / recoverability) ───────────────────────────
    # Fernet key (url-safe base64, 32 bytes) — `python -m app.backup gen-key`.
    # Empty = backups disabled (the app runs; the pre-start hook no-ops).
    backup_encryption_key: SecretStr = SecretStr("")
    # Offsite target. Set EITHER an S3-compatible bucket OR a directory
    # (a second mounted volume, or local for testing).
    backup_s3_bucket: str = ""
    backup_s3_endpoint: str = ""      # e.g. https://<acct>.r2.cloudflarestorage.com; empty = AWS
    backup_s3_region: str = "eu-central-1"
    backup_s3_access_key: SecretStr = SecretStr("")
    backup_s3_secret_key: SecretStr = SecretStr("")
    backup_offsite_dir: str = ""      # directory offsite target (alternative to S3)
    backup_retention_daily: int = 30
    backup_retention_monthly: int = 12
    backup_alert_webhook: str = ""    # optional: POST {text} here on backup/integrity failure

    # ── Environment ──────────────────────────────────────────────────────
    # "production" turns on the strict startup checks (COOKIE_SECURE, strong
    # ADMIN_PASSWORD, an LLM key) and disables the interactive API docs.
    app_env: str = "development"

    # ── LLM data-processing posture (see docs/DATA_PROCESSING.md) ─────────
    # Confidential data only ever goes to an approved official endpoint whose
    # commercial terms exclude training. A custom base_url pointing anywhere
    # else (a proxy/aggregator) is rejected.
    llm_allowed_hosts: str = "api.anthropic.com,api.openai.com"
    # The operator sets this to true once the provider DPA / zero-retention
    # terms are filed. Required in production; a bad host fails always.
    llm_no_training_ack: bool = False

    # ── Observability ────────────────────────────────────────────────────
    sentry_dsn: str = ""              # empty = Sentry disabled (no-op)
    sentry_environment: str = "production"
    # /readyz alerts when free disk on DATA_DIR falls below this fraction.
    disk_free_min_ratio: float = 0.10

    # ── PDF export (PRD: server-side PPTX → PDF converter) ──────────────
    # "auto": LibreOffice when `soffice` is installed, else the built-in
    # PyMuPDF renderer; "libreoffice": LibreOffice only (fatal in production
    # when it is missing); "pymupdf": never call LibreOffice.
    pdf_converter: Literal["auto", "libreoffice", "pymupdf"] = "auto"
    soffice_path: str = "soffice"          # binary name or absolute path
    soffice_timeout_seconds: int = 180

    # ── Guard rails ──────────────────────────────────────────────────────
    max_upload_mb: int = 25
    # Documents longer than this are rejected before any paid API call —
    # insurer quotes are short; a 100+ page PDF is almost always a mistake.
    max_pdf_pages: int = 60
    # Per-client-IP cap on the paid/heavy POST endpoints. 0 disables.
    rate_limit_per_minute: int = 30

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("supabase_url")
    @classmethod
    def _supabase_origin(cls, value: str) -> str:
        """SUPABASE_URL is the project origin (`https://<ref>.supabase.co`):
        the issuer and JWKS URL are derived from it, so a path, query or a
        non-http scheme would silently make every token fail verification.
        Normalised without a trailing slash; empty disables bearer auth."""
        value = value.strip().rstrip("/")
        if not value:
            return ""
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError("SUPABASE_URL must be an http(s) origin such as https://<ref>.supabase.co")
        if parts.path or parts.query or parts.fragment:
            raise ValueError("SUPABASE_URL must be the project origin only (no path or query)")
        return value

    @field_validator("supabase_jwt_audience")
    @classmethod
    def _audience_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("SUPABASE_JWT_AUDIENCE cannot be blank")
        return value

    @field_validator("database_url")
    @classmethod
    def _database_url_scheme(cls, value: str) -> str:
        value = value.strip()
        if not value:
            return ""
        scheme = value.split("://", 1)[0].lower()
        if scheme in ("postgres", "postgresql", "postgresql+psycopg", "sqlite"):
            return value
        raise ValueError("DATABASE_URL must be a postgresql:// (or sqlite:///) URL")

    @property
    def database_url_effective(self) -> str:
        """The SQLAlchemy URL actually used: PostgreSQL via psycopg when
        DATABASE_URL is set, else `<DATA_DIR>/projects.db` on SQLite."""
        url = self.database_url
        if not url:
            return "sqlite:///" + (self.data_path / "projects.db").as_posix()
        scheme, rest = url.split("://", 1)
        if scheme.lower() in ("postgres", "postgresql"):
            return "postgresql+psycopg://" + rest
        return url

    @property
    def admin_email_set(self) -> frozenset[str]:
        return frozenset(e.strip().lower() for e in self.admin_emails.split(",") if e.strip())

    @property
    def supabase_storage_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key.get_secret_value())

    @property
    def supabase_auth_enabled(self) -> bool:
        """Bearer-token auth is on when either verification path is configured."""
        return bool(self.supabase_url or self.supabase_jwt_secret.get_secret_value())

    @property
    def data_path(self) -> Path:
        if self.data_dir:
            return Path(self.data_dir)
        return Path(__file__).resolve().parents[3] / "data"


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor — import this everywhere instead of Settings()."""
    return Settings()
