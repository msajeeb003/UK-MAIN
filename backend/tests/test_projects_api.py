"""Project management API (BRD 2.9 / S2 / S3): CRUD, search, the
insurers-approached relation, erasure and the legacy-blob import — on the
relational store (SQLite fallback in tests, PostgreSQL in production)."""

import time

import pytest
from sqlalchemy import select

from app.db.engine import session_scope
from app.db.models import ProjectInsurer
from app.services import projects as repo


def _body(**overrides) -> dict:
    body = {
        "client_name": "Aldgate Timber Ltd",
        "reference": "UKB-1001",
        "project_type": "renewal",
        "policy_type": "Whole Turnover",
        "status": "draft",
        "insurers_approached": ["allianz", "coface", "qbe"],
        "state": {"columns": [], "credit": [], "files": [], "confirmed": {}},
    }
    body.update(overrides)
    return body


@pytest.fixture
def clean(client):
    """Delete every project before and after so listing/search assertions
    are exact regardless of what other test modules left behind."""
    def wipe():
        with session_scope() as session:
            ids = [p.id for p, in session.execute(select(repo.Project)).all()]
        for pid in ids:
            client.delete(f"/projects/{pid}")
    wipe()
    yield client
    wipe()


# ── Auth guard ──────────────────────────────────────────────────────────────

def test_project_endpoints_require_sign_in(anon_client):
    assert anon_client.get("/projects").status_code == 401
    assert anon_client.post("/projects", json=_body()).status_code == 401
    assert anon_client.get("/projects/x").status_code == 401
    assert anon_client.put("/projects/x", json=_body()).status_code == 401
    assert anon_client.patch("/projects/x", json={}).status_code == 401
    assert anon_client.delete("/projects/x").status_code == 401
    assert anon_client.get("/projects/x/insurers").status_code == 401


# ── Create / detail ────────────────────────────────────────────────────────

def test_create_returns_resource_with_named_insurers(clean):
    res = clean.post("/projects", json=_body(id="crud-1"))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["id"] == "crud-1"
    assert body["client_name"] == "Aldgate Timber Ltd"
    assert body["project_type"] == "renewal" and body["status"] == "draft"
    assert [i["id"] for i in body["insurers_approached"]] == ["allianz", "coface", "qbe"]
    assert [i["position"] for i in body["insurers_approached"]] == [0, 1, 2]
    assert body["insurers_approached"][0]["name"] == "Allianz Trade"
    assert body["owner_email"] and body["updated_by"] == body["owner_email"]
    assert body["created_at"] and body["updated_at"] and body["generated_at"] is None
    assert body["state"]["columns"] == []

    detail = clean.get("/projects/crud-1")
    assert detail.status_code == 200 and detail.json() == body


def test_create_mints_an_id_when_none_given(clean):
    res = clean.post("/projects", json=_body())
    assert res.status_code == 201
    assert len(res.json()["id"]) == 16


def test_create_conflicts_on_existing_id(clean):
    assert clean.post("/projects", json=_body(id="dup-1")).status_code == 201
    assert clean.post("/projects", json=_body(id="dup-1")).status_code == 409


def test_validation_errors(clean):
    unknown = clean.post("/projects", json=_body(insurers_approached=["allianz", "acme-re"]))
    assert unknown.status_code == 422
    assert unknown.json()["detail"]["unknown"] == ["acme-re"]
    assert clean.post("/projects", json=_body(status="archived")).status_code == 422
    assert clean.post("/projects", json=_body(project_type="mid-term")).status_code == 422
    assert clean.post("/projects", json=_body(id="bad id!")).status_code == 422
    assert clean.put("/projects/bad%20id", json=_body()).status_code == 422
    assert clean.get("/projects/does-not-exist").status_code == 404
    assert clean.patch("/projects/does-not-exist", json={"client_name": "x"}).status_code == 404
    assert clean.delete("/projects/does-not-exist").status_code == 404


def test_state_size_limit(clean):
    huge = {"blob": "x" * (2 * 1024 * 1024 + 10)}
    assert clean.post("/projects", json=_body(id="big-1", state=huge)).status_code == 413


# ── Update ─────────────────────────────────────────────────────────────────

def test_put_creates_then_replaces_whole_resource(clean):
    first = clean.put("/projects/put-1", json=_body())
    assert first.status_code == 201
    created_at = first.json()["created_at"]

    replaced = clean.put("/projects/put-1", json={"client_name": "Only Name Ltd"})
    assert replaced.status_code == 200
    body = replaced.json()
    assert body["client_name"] == "Only Name Ltd"
    assert body["reference"] == "" and body["project_type"] is None      # PUT = full replace
    assert body["insurers_approached"] == []
    assert body["created_at"] == created_at                               # creation stamp kept
    assert body["updated_at"] >= first.json()["updated_at"]


def test_patch_changes_only_the_fields_sent(clean):
    clean.post("/projects", json=_body(id="patch-1"))
    res = clean.patch("/projects/patch-1", json={"status": "sent", "reference": "UKB-2"})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "sent" and body["reference"] == "UKB-2"
    assert body["client_name"] == "Aldgate Timber Ltd"                    # untouched
    assert [i["id"] for i in body["insurers_approached"]] == ["allianz", "coface", "qbe"]
    assert body["state"]["columns"] == []

    res = clean.patch("/projects/patch-1", json={"generated_at": "2026-09-15T10:00:00Z",
                                                  "state": {"columns": [1]}})
    assert res.json()["generated_at"].startswith("2026-09-15T10:00:00")
    assert res.json()["state"] == {"columns": [1]}                        # state replaced whole
    assert res.json()["reference"] == "UKB-2"


def test_client_name_and_reference_are_tidied(clean):
    res = clean.post("/projects", json=_body(id="tidy-1", client_name="  Aldgate   Timber  ",
                                             reference=" UKB-1 "))
    assert res.json()["client_name"] == "Aldgate Timber"
    assert res.json()["reference"] == "UKB-1"


# ── Insurers approached (relation) ────────────────────────────────────────

def test_insurers_relation_endpoints(clean):
    clean.post("/projects", json=_body(id="ins-1", insurers_approached=["qbe"]))

    res = clean.get("/projects/ins-1/insurers")
    assert res.status_code == 200
    assert [i["id"] for i in res.json()["insurers"]] == ["qbe"]

    # Append (idempotent), keeping order.
    assert clean.post("/projects/ins-1/insurers/allianz").status_code == 200
    res = clean.post("/projects/ins-1/insurers/allianz")
    assert [i["id"] for i in res.json()["insurers"]] == ["qbe", "allianz"]

    # Replace the whole ordered list; duplicates collapse to the first.
    res = clean.put("/projects/ins-1/insurers", json={"insurers": ["coface", "qbe", "coface"]})
    assert [(i["id"], i["position"]) for i in res.json()["insurers"]] == [("coface", 0), ("qbe", 1)]

    # Remove one.
    assert clean.delete("/projects/ins-1/insurers/coface").status_code == 204
    assert [i["id"] for i in clean.get("/projects/ins-1/insurers").json()["insurers"]] == ["qbe"]
    assert clean.delete("/projects/ins-1/insurers/coface").status_code == 204   # idempotent

    # Validation and 404s.
    assert clean.post("/projects/ins-1/insurers/nobody").status_code == 422
    assert clean.put("/projects/ins-1/insurers", json={"insurers": ["nobody"]}).status_code == 422
    assert clean.get("/projects/none/insurers").status_code == 404
    assert clean.post("/projects/none/insurers/qbe").status_code == 404

    # The relation rows are real rows, and the resource reflects them.
    with session_scope() as session:
        rows = session.scalars(select(ProjectInsurer).where(ProjectInsurer.project_id == "ins-1")).all()
        assert [(r.insurer_id, r.position) for r in rows] == [("qbe", 0)]
    assert [i["id"] for i in clean.get("/projects/ins-1").json()["insurers_approached"]] == ["qbe"]


def test_delete_cascades_to_insurer_rows(clean):
    clean.post("/projects", json=_body(id="cas-1"))
    assert clean.delete("/projects/cas-1").status_code == 204
    with session_scope() as session:
        assert session.scalars(
            select(ProjectInsurer).where(ProjectInsurer.project_id == "cas-1")).all() == []


# ── Search / list ──────────────────────────────────────────────────────────

def _seed_search(client) -> None:
    client.post("/projects", json=_body(id="s-1", client_name="Aldgate Timber Ltd",
                                        reference="UKB-1001", project_type="renewal",
                                        status="draft", insurers_approached=["allianz", "qbe"]))
    time.sleep(0.01)
    client.post("/projects", json=_body(id="s-2", client_name="Brixton Foods plc",
                                        reference="UKB-1002", project_type="new",
                                        status="ready", insurers_approached=["coface"]))
    time.sleep(0.01)
    client.post("/projects", json=_body(id="s-3", client_name="Camden Metals",
                                        reference="TIMBER-9", project_type="new",
                                        status="sent", insurers_approached=["qbe", "zurich"]))


def test_list_defaults_newest_first_with_paging(clean):
    _seed_search(clean)
    res = clean.get("/projects")
    assert res.status_code == 200
    body = res.json()
    assert [p["id"] for p in body["items"]] == ["s-3", "s-2", "s-1"]
    assert body["total"] == 3 and body["limit"] == 50 and body["offset"] == 0

    page = clean.get("/projects", params={"limit": 2, "offset": 2}).json()
    assert [p["id"] for p in page["items"]] == ["s-1"] and page["total"] == 3
    assert clean.get("/projects", params={"limit": 0}).status_code == 422
    assert clean.get("/projects", params={"limit": 1000}).status_code == 422


def test_search_matches_client_or_reference_case_insensitively(clean):
    _seed_search(clean)
    hits = clean.get("/projects", params={"q": "timber"}).json()
    assert sorted(p["id"] for p in hits["items"]) == ["s-1", "s-3"]     # name and reference
    assert hits["total"] == 2
    assert [p["id"] for p in clean.get("/projects", params={"q": "ukb-100"}).json()["items"]] == ["s-2", "s-1"]
    assert clean.get("/projects", params={"q": "%"}).json()["total"] == 0  # wildcards are literal
    assert clean.get("/projects", params={"q": "nothing here"}).json()["total"] == 0


def test_filters_by_status_type_and_insurer(clean):
    _seed_search(clean)
    assert [p["id"] for p in clean.get("/projects", params={"status": "ready"}).json()["items"]] == ["s-2"]
    multi = clean.get("/projects", params=[("status", "draft"), ("status", "sent")]).json()
    assert sorted(p["id"] for p in multi["items"]) == ["s-1", "s-3"]
    assert [p["id"] for p in clean.get("/projects", params={"project_type": "renewal"}).json()["items"]] == ["s-1"]
    assert clean.get("/projects", params={"project_type": "other"}).status_code == 422
    by_qbe = clean.get("/projects", params={"insurer": "qbe"}).json()
    assert sorted(p["id"] for p in by_qbe["items"]) == ["s-1", "s-3"]
    assert clean.get("/projects", params={"insurer": "coface", "status": "draft"}).json()["total"] == 0
    combined = clean.get("/projects", params={"q": "ukb", "insurer": "allianz"}).json()
    assert [p["id"] for p in combined["items"]] == ["s-1"]


def test_sorting(clean):
    _seed_search(clean)
    ids = lambda sort: [p["id"] for p in clean.get("/projects", params={"sort": sort}).json()["items"]]  # noqa: E731
    assert ids("client_asc") == ["s-1", "s-2", "s-3"]
    assert ids("client_desc") == ["s-3", "s-2", "s-1"]
    assert ids("created_asc") == ["s-1", "s-2", "s-3"]
    assert ids("updated_asc") == ["s-1", "s-2", "s-3"]
    clean.patch("/projects/s-1", json={"status": "closed"})       # touching it makes it newest
    assert ids("updated_desc")[0] == "s-1"
    assert clean.get("/projects", params={"sort": "random"}).status_code == 422


# ── Retention hook + legacy import ─────────────────────────────────────────

def test_expired_ids_uses_updated_at(clean):
    from datetime import UTC, datetime, timedelta

    clean.post("/projects", json=_body(id="old-p"))
    clean.post("/projects", json=_body(id="new-p"))
    with session_scope() as session:
        repo.require(session, "old-p").updated_at = datetime.now(UTC) - timedelta(days=40)
    with session_scope() as session:
        cutoff = datetime.now(UTC) - timedelta(days=30)
        assert repo.expired_ids(session, cutoff) == ["old-p"]


def test_legacy_blob_rows_are_imported_once(clean):
    """Projects saved by the previous build (one JSON blob per SQLite row)
    come across with their facts as columns; unknown insurers are dropped;
    an id already in the store is left alone."""
    import json

    from app.core import db

    blob = {"id": "legacy-1", "clientName": "Old Client Ltd", "ref": "OLD-1",
            "projectType": "renewal", "policyType": "Whole Turnover", "status": "ready",
            "approached": ["qbe", "gone-insurer", "allianz", "qbe"],
            "created": 1_757_000_000_000, "updated": 1_757_100_000_000,
            "generatedAt": 1_757_050_000_000, "columns": [{"id": "c1"}]}
    db.execute("INSERT INTO projects (id, client_name, updated, state) VALUES (?,?,?,?)",
               ("legacy-1", "Old Client Ltd", 1_757_100_000.0, json.dumps(blob)))
    clean.post("/projects", json=_body(id="legacy-2", client_name="Already Here"))
    db.execute("INSERT INTO projects (id, client_name, updated, state) VALUES (?,?,?,?)",
               ("legacy-2", "Stale Copy", 1_757_100_000.0, json.dumps({"clientName": "Stale Copy"})))
    try:
        with session_scope() as session:
            assert repo.import_legacy(session) == 1
        body = clean.get("/projects/legacy-1").json()
        assert body["client_name"] == "Old Client Ltd" and body["reference"] == "OLD-1"
        assert body["project_type"] == "renewal" and body["status"] == "ready"
        assert body["policy_type"] == "Whole Turnover"
        assert [i["id"] for i in body["insurers_approached"]] == ["qbe", "allianz"]
        assert body["generated_at"].startswith("2025-09-05")
        assert body["state"]["columns"] == [{"id": "c1"}]
        assert clean.get("/projects/legacy-2").json()["client_name"] == "Already Here"
        with session_scope() as session:
            assert repo.import_legacy(session) == 0              # idempotent
    finally:
        db.execute("DELETE FROM projects WHERE id IN ('legacy-1', 'legacy-2')")
