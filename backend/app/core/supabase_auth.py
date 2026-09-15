"""
Supabase Auth bearer tokens (BRD 2.10 / S1 for the Next.js frontend).

The web app (web/) signs users in with Supabase Auth and calls this API
with `Authorization: Bearer <access token>`. Tokens are verified locally:

- HS256 with SUPABASE_JWT_SECRET (the project's legacy JWT secret), or
- ES256 / RS256 against the project's JWKS, fetched from SUPABASE_URL and
  cached (PyJWKClient), for projects on asymmetric signing keys.

Only the `authenticated` role is accepted, the audience/issuer must match
the project, and `exp`/`sub` are required. No self-registration exists in
the app: a valid token therefore always belongs to an account an
administrator created (see web/scripts/users.mjs and docs/AUTH.md).
"""

import logging
import threading

import jwt
from jwt import PyJWKClient

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_ALLOWED_ALGS = {"HS256", "RS256", "ES256"}
_LEEWAY_SECONDS = 30            # tolerate small clock skew
_JWKS_LIFESPAN_SECONDS = 600

_jwks_lock = threading.Lock()
_jwks_client: PyJWKClient | None = None
_jwks_url = ""


def is_configured() -> bool:
    return get_settings().supabase_auth_enabled


def _jwks(url: str) -> PyJWKClient:
    """One cached JWKS client per project URL (thread-safe)."""
    global _jwks_client, _jwks_url
    jwks_url = f"{url}/auth/v1/.well-known/jwks.json"
    with _jwks_lock:
        if _jwks_client is None or _jwks_url != jwks_url:
            _jwks_client = PyJWKClient(
                jwks_url, cache_keys=True, lifespan=_JWKS_LIFESPAN_SECONDS, timeout=10,
            )
            _jwks_url = jwks_url
        return _jwks_client


def verify_token(token: str) -> dict | None:
    """Return {"id", "email", "name"} for a valid Supabase access token, or
    None. Never raises: any verification problem means "not signed in"."""
    settings = get_settings()
    url = settings.supabase_url.rstrip("/")
    secret = settings.supabase_jwt_secret.get_secret_value()
    if not (url or secret):
        return None                                     # feature disabled

    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg")
        if alg not in _ALLOWED_ALGS:
            return None
        if alg == "HS256":
            if not secret:
                return None
            key = secret
        else:
            if not url:
                return None
            key = _jwks(url).get_signing_key_from_jwt(token).key

        decode_kwargs: dict = {
            "algorithms": [alg],
            "audience": settings.supabase_jwt_audience,
            "leeway": _LEEWAY_SECONDS,
            "options": {"require": ["exp", "sub"]},
        }
        if url:
            decode_kwargs["issuer"] = f"{url}/auth/v1"
        claims = jwt.decode(token, key, **decode_kwargs)
    except jwt.PyJWTError as exc:
        logger.info("Supabase token rejected: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001 — e.g. JWKS fetch failure
        logger.warning("Supabase token verification failed: %s", exc)
        return None

    if claims.get("role") != "authenticated":
        return None
    email = str(claims.get("email") or "").strip().lower()
    if not email:
        return None
    meta = claims.get("user_metadata") or {}
    name = meta.get("name") or meta.get("full_name") or ""
    # app_metadata is set server-side only (service role), so the role
    # claim cannot be self-assigned from the browser.
    app_meta = claims.get("app_metadata") or {}
    role = "admin" if app_meta.get("role") == "admin" else "broker"
    return {"id": claims["sub"], "email": email, "name": str(name), "role": role}
