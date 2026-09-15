"""Production config lock: startup checks, password policy, docs gating."""

import threading

import pytest

from app.core import startup
from app.core.config import get_settings


def test_password_policy():
    assert startup.password_problem("short") is not None
    assert startup.password_problem("local-dev-password-1") is not None   # denylist
    assert startup.password_problem("aaaaaaaaaaaa") is not None            # low variety
    assert startup.password_problem("Zurich-Atradius-2026!") is None       # strong


def test_prod_refuses_insecure_cookie(monkeypatch):
    s = get_settings()
    from pydantic import SecretStr
    monkeypatch.setattr(s, "app_env", "production")
    monkeypatch.setattr(s, "cookie_secure", False)
    monkeypatch.setattr(s, "admin_password", SecretStr("Zurich-Atradius-2026!"))
    monkeypatch.setattr(s, "anthropic_api_key", SecretStr("sk-ant-test"))
    with pytest.raises(RuntimeError, match="COOKIE_SECURE"):
        startup.run_startup_checks()


def test_prod_refuses_weak_admin_password(monkeypatch):
    s = get_settings()
    from pydantic import SecretStr
    monkeypatch.setattr(s, "app_env", "production")
    monkeypatch.setattr(s, "cookie_secure", True)
    monkeypatch.setattr(s, "admin_password", SecretStr("changeme"))
    monkeypatch.setattr(s, "anthropic_api_key", SecretStr("sk-ant-test"))
    with pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
        startup.run_startup_checks()


def test_prod_refuses_without_llm_key(monkeypatch):
    s = get_settings()
    from pydantic import SecretStr
    monkeypatch.setattr(s, "app_env", "production")
    monkeypatch.setattr(s, "cookie_secure", True)
    monkeypatch.setattr(s, "admin_password", SecretStr("Zurich-Atradius-2026!"))
    monkeypatch.setattr(s, "anthropic_api_key", SecretStr(""))
    monkeypatch.setattr(s, "openai_api_key", SecretStr(""))
    with pytest.raises(RuntimeError, match="LLM provider"):
        startup.run_startup_checks()


def test_prod_refuses_stub_provider(monkeypatch):
    """The deterministic test/demo extractor must never run in production."""
    s = get_settings()
    from pydantic import SecretStr
    monkeypatch.setattr(s, "app_env", "production")
    monkeypatch.setattr(s, "cookie_secure", True)
    monkeypatch.setattr(s, "admin_password", SecretStr("Zurich-Atradius-2026!"))
    monkeypatch.setattr(s, "anthropic_api_key", SecretStr("sk-ant-test"))
    monkeypatch.setattr(s, "llm_no_training_ack", True)
    monkeypatch.setattr(s, "llm_provider", "stub")
    with pytest.raises(RuntimeError, match="stub"):
        startup.run_startup_checks()


def test_prod_boots_when_configured(monkeypatch):
    s = get_settings()
    from pydantic import SecretStr
    monkeypatch.setattr(s, "app_env", "production")
    monkeypatch.setattr(s, "cookie_secure", True)
    monkeypatch.setattr(s, "admin_password", SecretStr("Zurich-Atradius-2026!"))
    monkeypatch.setattr(s, "anthropic_api_key", SecretStr("sk-ant-test"))
    monkeypatch.setattr(s, "llm_no_training_ack", True)   # DPA filed
    monkeypatch.setattr(s, "supabase_url", "https://unit.supabase.co")
    startup.run_startup_checks()          # no raise


def test_dev_is_lenient(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "app_env", "development")
    monkeypatch.setattr(s, "cookie_secure", False)
    startup.run_startup_checks()          # no raise in dev


def test_session_cookie_flags(client):
    """HttpOnly + SameSite=Lax are set on the session cookie."""
    from tests.conftest import TEST_USER
    login = client.post("/auth/login",
                        json={"email": TEST_USER[0], "password": TEST_USER[1]})
    set_cookie = login.headers.get("set-cookie", "")
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie.lower() or "samesite=lax" in set_cookie.lower()


def test_docs_available_in_dev(anon_client):
    # tests run in development, so the docs are on
    assert anon_client.get("/openapi.json").status_code == 200


def test_secrets_do_not_leak_in_repr():
    s = get_settings()
    assert "get_secret_value" not in repr(s.admin_password)
    assert s.anthropic_api_key.get_secret_value() not in repr(s.anthropic_api_key)
    assert "**" in repr(s.admin_password) or "Secret" in repr(s.admin_password)


def test_prod_refuses_plain_http_supabase_url(monkeypatch):
    s = get_settings()
    from pydantic import SecretStr
    monkeypatch.setattr(s, "app_env", "production")
    monkeypatch.setattr(s, "cookie_secure", True)
    monkeypatch.setattr(s, "anthropic_api_key", SecretStr("sk-ant-test"))
    monkeypatch.setattr(s, "llm_no_training_ack", True)
    monkeypatch.setattr(s, "admin_password", SecretStr("Zurich-Atradius-2026!"))
    monkeypatch.setattr(s, "supabase_url", "http://supabase.internal")
    with pytest.raises(RuntimeError, match="SUPABASE_URL must use https"):
        startup.run_startup_checks()
    monkeypatch.setattr(s, "supabase_url", "https://unit.supabase.co")
    startup.run_startup_checks()          # https is fine


def test_supabase_url_is_validated_and_normalised(monkeypatch):
    from pydantic import ValidationError

    from app.core.config import Settings

    monkeypatch.setenv("SUPABASE_URL", "https://unit.supabase.co/")
    assert Settings().supabase_url == "https://unit.supabase.co"
    assert Settings().supabase_auth_enabled is True
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "")
    assert Settings().supabase_auth_enabled is False
    for bad in ("unit.supabase.co", "ftp://unit.supabase.co", "https://unit.supabase.co/auth/v1"):
        monkeypatch.setenv("SUPABASE_URL", bad)
        with pytest.raises(ValidationError):
            Settings()
    monkeypatch.setenv("SUPABASE_URL", "https://unit.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_AUDIENCE", "  ")
    with pytest.raises(ValidationError):
        Settings()


def test_lifespan_seeds_admin_and_stops_cleanly(monkeypatch):
    """The lifespan replaces the deprecated on_event hooks: start-up seeds
    the first user and launches the housekeeping loops; shutdown cancels
    them without hanging."""
    from fastapi.testclient import TestClient

    from app import main

    seeded: list[bool] = []
    swept = threading.Event()
    monkeypatch.setattr(main, "seed_admin_if_empty", lambda: seeded.append(True))
    monkeypatch.setattr(main, "delete_expired_sessions", swept.set)
    with TestClient(main.app):
        assert seeded == [True]
        assert swept.wait(5)            # first sweep runs right after start-up
