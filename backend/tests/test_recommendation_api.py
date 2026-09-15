"""Recommendation (BRD 2.7, S7): the chosen insurer must have a quote in
the project; declined insurers are refused; null clears."""

import pytest

PID = "rec-p1"


@pytest.fixture
def project(client):
    state = {
        "columns": [
            {"id": "c-exp", "name": "Expiring policy", "expiring": True, "manual": False, "data": {}, "debt": ""},
            {"id": "c-al", "name": "Allianz Trade", "matched": "Allianz Trade", "expiring": False,
             "manual": False, "data": {}, "debt": "Included"},
            {"id": "c-qbe", "name": "QBE UK LIMITED", "matched": "QBE", "expiring": False,
             "manual": False, "data": {}, "debt": "Outsourced"},
            {"id": "c-free", "name": "Free-format column", "manual": True, "expiring": False, "data": {}, "debt": ""},
        ],
        "recommended": "c-al", "reasons": "- Highest indemnity",
    }
    body = {"client_name": "Rec Test Ltd", "insurers_approached": ["allianz", "qbe", "coface"], "state": state}
    assert client.put(f"/projects/{PID}", json=body).status_code in (200, 201)
    yield client
    client.delete(f"/projects/{PID}")


def test_get_recommendation(project):
    res = project.get(f"/projects/{PID}/recommendation")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["insurer"] == "Allianz Trade" and body["insurer_id"] == "allianz" and body["column_id"] == "c-al"
    assert body["reasons"] == "- Highest indemnity" and body["key_differences"] == ""
    assert [c["column_id"] for c in body["candidates"]] == ["c-al", "c-qbe", "c-free"]   # quotes only
    assert next(c for c in body["candidates"] if c["column_id"] == "c-qbe")["insurer_id"] == "qbe"
    assert body["declined"] == ["Coface"]                                             # approached, no quote
    assert project.get("/projects/none/recommendation").status_code == 404


def test_put_recommendation_by_canonical_name(project):
    res = project.put(f"/projects/{PID}/recommendation",
                      json={"insurer": "QBE", "reasons": "- Lower premium\n- Debt collection included",
                            "key_differences": "Excess £1,000 lower"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["insurer"] == "QBE" and body["column_id"] == "c-qbe"
    assert body["reasons"].startswith("- Lower premium") and body["key_differences"] == "Excess £1,000 lower"
    # Stored as the review screen stores it.
    state = project.get(f"/projects/{PID}").json()["state"]
    assert state["recommended"] == "c-qbe" and state["keyDifferences"] == "Excess £1,000 lower"
    entries = project.get("/audit").json()["entries"]
    assert any(e["action"] == "recommendation.set" and e["target"] == PID and "QBE" in e["detail"] for e in entries)

    # Legal names and ids resolve to the same insurer; case does not matter.
    assert project.put(f"/projects/{PID}/recommendation", json={"insurer": "qbe uk limited"}).json()["column_id"] == "c-qbe"
    assert project.put(f"/projects/{PID}/recommendation", json={"insurer": "allianz"}).json()["column_id"] == "c-al"


def test_declined_or_absent_insurers_are_refused(project):
    res = project.put(f"/projects/{PID}/recommendation", json={"insurer": "Coface", "reasons": "x"})
    assert res.status_code == 422 and "declined" in res.json()["detail"]
    res = project.put(f"/projects/{PID}/recommendation", json={"insurer": "Chubb"})
    assert res.status_code == 422 and "no quote" in res.json()["detail"]
    res = project.put(f"/projects/{PID}/recommendation", json={"insurer": "Acme Re"})
    assert res.status_code == 422 and "Unknown insurer" in res.json()["detail"]
    # A refused request changes nothing.
    assert project.get(f"/projects/{PID}/recommendation").json()["column_id"] == "c-al"


def test_null_clears_the_choice_and_keeps_the_texts(project):
    res = project.put(f"/projects/{PID}/recommendation",
                      json={"insurer": None, "reasons": "Awaiting client call", "key_differences": ""})
    assert res.status_code == 200
    assert res.json()["insurer"] is None and res.json()["column_id"] is None
    assert res.json()["reasons"] == "Awaiting client call"
    assert project.get(f"/projects/{PID}").json()["state"]["recommended"] is None


def test_recommendation_requires_sign_in(anon_client):
    assert anon_client.get(f"/projects/{PID}/recommendation").status_code == 401
    assert anon_client.put(f"/projects/{PID}/recommendation", json={"insurer": None}).status_code == 401
