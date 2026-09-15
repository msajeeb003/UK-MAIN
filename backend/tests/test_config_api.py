"""Admin configuration (BRD 2.3/2.4): the standing insurer list and the
terminology map, maintained from the app — role-gated, versioned,
audited, and live for the next extraction without a restart."""

import pytest

from app.core.config import get_settings
from app.llm.prompt import build_system_prompt
from app.services import config_store, library
from tests.conftest import TEST_USER
from tests.test_supabase_auth import _bearer, _configure, _token


@pytest.fixture
def admin(client, monkeypatch):
    """The signed-in test user promoted through ADMIN_EMAILS."""
    monkeypatch.setattr(get_settings(), "admin_emails", f"other@x.test, {TEST_USER[0].upper()}")
    library.invalidate()
    yield client
    _wipe()


def _wipe():
    """Return the store to the seed files so other tests see the defaults."""
    from app.db.engine import session_scope
    from app.db.models import ConfigDocument

    with session_scope() as session:
        for name in config_store.DOCUMENTS:
            row = session.get(ConfigDocument, name)
            if row is not None:
                session.delete(row)
    library.invalidate()


def _seed_insurers(client) -> list[dict]:
    return client.get("/config/insurers").json()["insurers"]


# ── Role gate ───────────────────────────────────────────────────────────────

def test_non_admin_gets_403(client):
    assert client.get("/auth/me").json()["role"] == "broker"
    assert client.get("/config/insurers").status_code == 403
    assert client.put("/config/insurers", json={"insurers": []}).status_code == 403
    assert client.get("/config/terminology").status_code == 403
    assert client.put("/config/terminology", json={"fields": {}}).status_code == 403


def test_config_requires_sign_in(anon_client):
    assert anon_client.get("/config/insurers").status_code == 401


def test_admin_role_from_supabase_app_metadata(anon_client, monkeypatch):
    _configure(monkeypatch)
    plain = anon_client.get("/auth/me", headers=_bearer(_token()))
    assert plain.json()["role"] == "broker"
    assert anon_client.get("/config/insurers", headers=_bearer(_token())).status_code == 403
    admin_token = _token(app_metadata={"role": "admin", "provider": "email"})
    assert anon_client.get("/auth/me", headers=_bearer(admin_token)).json()["role"] == "admin"
    res = anon_client.get("/config/insurers", headers=_bearer(admin_token))
    assert res.status_code == 200 and res.json()["source"] == "file"


# ── Insurers ────────────────────────────────────────────────────────────────

def test_seed_file_is_served_until_first_save(admin):
    res = admin.get("/config/insurers")
    assert res.status_code == 200
    body = res.json()
    assert body["version"] == 0 and body["source"] == "file" and body["updated_by"] is None
    ids = [i["id"] for i in body["insurers"]]
    assert "allianz" in ids and "qbe" in ids
    qbe = next(i for i in body["insurers"] if i["id"] == "qbe")
    assert qbe["name"] == "QBE" and "QBE UK LIMITED" in qbe["legal_names"]   # legacy aliases folded in
    assert qbe["debt_collection"] == "outsourced" and qbe["active"] is True


def test_adding_a_legal_name_changes_the_next_extraction_mapping(admin):
    assert library.match_insurer("Q-Be Underwriting Ltd") is None
    insurers = _seed_insurers(admin)
    qbe = next(i for i in insurers if i["id"] == "qbe")
    qbe["legal_names"].append("Q-Be Underwriting Ltd")
    qbe["debt_collection"] = "included"                                        # rule change
    zurich = next(i for i in insurers if i["id"] == "zurich")
    zurich["active"] = False
    insurers.append({"id": "newco", "name": "NewCo Credit", "legal_names": ["New Company Insurance"],
                     "debt_collection": "outsourced", "active": True})

    res = admin.put("/config/insurers", json={"insurers": insurers})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["version"] == 1 and body["source"] == "database" and body["updated_by"] == TEST_USER[0]
    assert body["updated_at"]

    # Live for the pipeline, no restart: name matching and the debt rule.
    assert library.match_insurer("Q-Be Underwriting Ltd")["id"] == "qbe"
    assert library.debt_collection_rule("New Company Insurance") == ("Outsourced", "NewCo Credit")
    assert library.debt_collection_rule("QBE UK") == ("Included", "QBE")
    assert "NewCo Credit" in build_system_prompt()
    # The setup list shows active insurers only; the config shows all.
    listed = [i["id"] for i in admin.get("/insurers").json()["insurers"]]
    assert "zurich" not in listed and "newco" in listed
    assert any(i["id"] == "zurich" and i["active"] is False for i in admin.get("/config/insurers").json()["insurers"])
    # Old projects still resolve an inactive insurer's name.
    assert library.match_insurer("Zurich")["id"] == "zurich"

    # Second save bumps the version; audited with who and when.
    res = admin.put("/config/insurers", json={"insurers": insurers})
    assert res.json()["version"] == 2
    entries = admin.get("/audit").json()["entries"]
    hits = [e for e in entries if e["action"] == "config.insurers"]
    assert len(hits) >= 2 and hits[0]["actor"] == TEST_USER[0] and hits[0]["target"] == "v2"


def test_insurers_validation(admin):
    base = _seed_insurers(admin)

    def put(insurers):
        return admin.put("/config/insurers", json={"insurers": insurers})

    dup = base + [{"id": "qbe", "name": "Another", "debt_collection": "outsourced"}]
    res = put(dup)
    assert res.status_code == 422 and any("duplicate id" in e for e in res.json()["detail"]["errors"])

    clash = [dict(i) for i in base]
    clash[0] = {**clash[0], "legal_names": clash[0]["legal_names"] + ["QBE"]}
    res = put(clash)
    assert res.status_code == 422 and any("already used" in e for e in res.json()["detail"]["errors"])

    bad = [dict(i) for i in base]
    bad[0] = {**bad[0], "debt_collection": "sometimes"}
    assert "included" in put(bad).json()["detail"]["errors"][0]

    assert put([{"id": "Bad Id!", "name": "X", "debt_collection": "included"}]).status_code == 422
    all_off = [{**i, "active": False} for i in base]
    assert any("active" in e for e in put(all_off).json()["detail"]["errors"])
    assert put([]).status_code == 422
    assert admin.get("/config/insurers").json()["version"] == 0                 # nothing was saved


# ── Terminology ─────────────────────────────────────────────────────────────

def test_terminology_seed_and_standard_fields(admin):
    res = admin.get("/config/terminology")
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "file" and len(body["standard_fields"]) == 16
    assert set(body["fields"]) == set(config_store.TERM_FIELDS)
    assert "Deductible" in body["fields"]["excess"] and body["insurers"] == {}


def test_adding_a_synonym_changes_the_next_extraction_prompt(admin):
    doc = admin.get("/config/terminology").json()
    assert "Retained Amount" not in build_system_prompt()
    doc["fields"]["excess"].append("Retained Amount")
    doc["insurers"] = {"qbe": {"excess": ["Policyholder Retention"], "indemnity": ["Cover Percentage"]}}
    res = admin.put("/config/terminology", json={"fields": doc["fields"], "insurers": doc["insurers"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["version"] == 1 and body["updated_by"] == TEST_USER[0]
    assert body["insurers"]["qbe"]["excess"] == ["Policyholder Retention"]

    merged = library.get_terminology()
    assert "Retained Amount" in merged["excess"] and "Policyholder Retention" in merged["excess"]
    assert "Cover Percentage" in merged["indemnity"]
    prompt = build_system_prompt()
    assert "Retained Amount" in prompt and "Policyholder Retention" in prompt
    assert any(e["action"] == "config.terminology" and e["actor"] == TEST_USER[0]
               for e in admin.get("/audit").json()["entries"])

    # An insurer with terminology cannot be dropped from the standing list.
    remaining = [i for i in _seed_insurers(admin) if i["id"] != "qbe"]
    res = admin.put("/config/insurers", json={"insurers": remaining})
    assert res.status_code == 422 and "qbe" in res.json()["detail"]["errors"][0]


def test_terminology_validation(admin):
    res = admin.put("/config/terminology", json={"fields": {"excess": ["x"], "type_of_policy": ["Cover type"]}})
    assert res.status_code == 422
    assert any("type_of_policy" in e and "16 standard fields" in e for e in res.json()["detail"]["errors"])
    res = admin.put("/config/terminology", json={"fields": {}, "insurers": {"nobody": {"excess": ["x"]}}})
    assert res.status_code == 422 and "unknown insurer" in res.json()["detail"]["errors"][0]
    res = admin.put("/config/terminology", json={"fields": {"excess": "Deductible"}})
    assert res.status_code == 422
    assert admin.get("/config/terminology").json()["version"] == 0


def test_store_outage_falls_back_to_the_last_known_copy(admin, monkeypatch):
    library.invalidate()
    seed = library.get_insurers()
    monkeypatch.setattr(config_store, "version", lambda name: (_ for _ in ()).throw(RuntimeError("db down")))
    library.invalidate()
    assert [i["id"] for i in library.get_insurers()] == [i["id"] for i in seed]   # file still serves
