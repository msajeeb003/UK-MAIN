"""Supabase Auth bearer tokens (BRD 2.10 / S1 for the Next.js app).

No network: tokens are minted here with the same HS256 secret the backend
is configured with, so verification is fully local.
"""

import time

import jwt
from pydantic import SecretStr

from app.core import supabase_auth
from app.core.config import get_settings

SIGNING_KEY = "unit-test-jwt-secret-not-for-production"
PROJECT = "https://unit.supabase.co"
ISSUER = f"{PROJECT}/auth/v1"


def _configure(monkeypatch, key=SIGNING_KEY, url=PROJECT):
    s = get_settings()
    monkeypatch.setattr(s, "supabase_jwt_secret", SecretStr(key))
    monkeypatch.setattr(s, "supabase_url", url)


def _token(key=SIGNING_KEY, **overrides):
    now = int(time.time())
    claims = {
        "sub": "3d5e0c4a-1111-4222-8333-444455556666",
        "email": "broker@ukcib.co.uk",
        "role": "authenticated",
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + 3600,
        "user_metadata": {"name": "Sam Broker"},
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="HS256")


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_valid_bearer_token_identifies_user(anon_client, monkeypatch):
    _configure(monkeypatch)
    res = anon_client.get("/auth/me", headers=_bearer(_token()))
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == "broker@ukcib.co.uk"
    assert body["name"] == "Sam Broker"


def test_verify_token_normalises_email_and_name(monkeypatch):
    _configure(monkeypatch)
    user = supabase_auth.verify_token(
        _token(email="  Broker@UKCIB.co.uk ", user_metadata={"full_name": "S. Broker"})
    )
    assert user == {
        "id": "3d5e0c4a-1111-4222-8333-444455556666",
        "email": "broker@ukcib.co.uk",
        "name": "S. Broker",
    }


def test_expired_token_rejected(anon_client, monkeypatch):
    _configure(monkeypatch)
    old = int(time.time()) - 7200
    res = anon_client.get("/auth/me", headers=_bearer(_token(iat=old, exp=old + 60)))
    assert res.status_code == 401


def test_wrong_secret_rejected(anon_client, monkeypatch):
    _configure(monkeypatch)
    res = anon_client.get("/auth/me", headers=_bearer(_token(key="someone-elses-secret")))
    assert res.status_code == 401


def test_wrong_audience_issuer_or_role_rejected(monkeypatch):
    _configure(monkeypatch)
    assert supabase_auth.verify_token(_token(aud="anon")) is None
    assert supabase_auth.verify_token(_token(iss="https://other.supabase.co/auth/v1")) is None
    assert supabase_auth.verify_token(_token(role="anon")) is None
    assert supabase_auth.verify_token(_token(role="service_role")) is None


def test_token_without_sub_exp_or_email_rejected(monkeypatch):
    _configure(monkeypatch)
    assert supabase_auth.verify_token(_token(sub=None)) is None
    assert supabase_auth.verify_token(_token(exp=None)) is None
    assert supabase_auth.verify_token(_token(email=None)) is None


def test_alg_none_and_garbage_rejected(monkeypatch):
    _configure(monkeypatch)
    unsigned = jwt.encode({"sub": "x", "email": "a@b.c", "role": "authenticated",
                           "aud": "authenticated", "exp": int(time.time()) + 60},
                          key=None, algorithm="none")
    assert supabase_auth.verify_token(unsigned) is None
    assert supabase_auth.verify_token("not.a.jwt") is None
    assert supabase_auth.verify_token("") is None


def test_disabled_when_unconfigured(anon_client, monkeypatch):
    _configure(monkeypatch, key="", url="")
    res = anon_client.get("/auth/me", headers=_bearer(_token()))
    assert res.status_code == 401


def test_malformed_authorization_header_rejected(anon_client, monkeypatch):
    _configure(monkeypatch)
    assert anon_client.get("/auth/me", headers={"Authorization": "Basic abc"}).status_code == 401
    assert anon_client.get("/auth/me", headers={"Authorization": "Bearer "}).status_code == 401


def test_bearer_write_needs_no_csrf_token(client, monkeypatch):
    """The Next.js app is not cookie-authenticated, so the CSRF check must
    not apply to bearer requests (which cannot be forged cross-site)."""
    _configure(monkeypatch)
    del client.headers["X-CSRF-Token"]
    res = client.post("/projects", json={"id": "sb-proj-1", "state": {"clientName": "Acme"}},
                      headers=_bearer(_token()))
    assert res.status_code == 200
    # The audit trail records the Supabase identity as the actor.
    entries = client.get("/audit", headers=_bearer(_token())).json()["entries"]
    assert any(e["actor"] == "broker@ukcib.co.uk" and e["target"] == "sb-proj-1"
               for e in entries)


def test_bad_bearer_never_falls_back_to_cookie(client, monkeypatch):
    """A cookie session plus an invalid Bearer header must be rejected, or a
    forged header could ride on the cookie while skipping the CSRF check."""
    _configure(monkeypatch)
    res = client.post("/projects", json={"id": "sb-proj-2", "state": {}},
                      headers=_bearer(_token(key="wrong")))
    assert res.status_code == 401
    res = client.get("/auth/me", headers=_bearer("garbage"))
    assert res.status_code == 401
