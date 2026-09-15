"""Comparison grid (BRD 2.3–2.5, S5): read, cell edits with revert,
set-field overrides, and the four confirm-before-export flags."""

import pytest

from app.services import grid

PID = "grid-p1"


def _column(col_id: str, name: str, **extra) -> dict:
    return {
        "id": col_id, "name": name, "manual": False, "expiring": False,
        "matched": extra.pop("matched", name), "debt": extra.pop("debt", ""),
        "docId": "doc-1", "pages": 3,
        "data": {
            "estimated_annual_premium_exc_ipt": {"value": "£12,000", "orig": "£12,000", "page": 2, "conf": "high"},
            "indemnity": {"value": "90%", "orig": "90%", "page": 1, "conf": "high"},
            "excess": {"value": "£5,000", "orig": "£5,000", "page": 2, "conf": "uncertain"},
            "max_annual_liability": {"value": "", "orig": "", "page": None, "conf": None},
            "premium_rate": {"value": "0.25%", "orig": "0.25%", "page": 1, "conf": "high"},
        },
        **extra,
    }


@pytest.fixture
def project(client):
    state = {
        "columns": [
            _column("c-allianz", "Allianz Trade", matched="Allianz Trade", debt="Included"),
            {"id": "c-exp", "name": "Expiring policy", "manual": False, "expiring": True,
             "matched": None, "debt": "", "data": {"indemnity": {"value": "85%", "orig": "85%", "page": 4}}},
            {"id": "c-free", "name": "Free-format column", "manual": True, "expiring": False,
             "matched": None, "debt": "", "data": {}},
        ],
        "confirmed": {"premium": True},
        "reviewed": True, "reviewedAt": 1_757_000_000_000,
    }
    body = {"client_name": "Grid Test Ltd", "policy_type": "Whole Turnover",
            "insurers_approached": ["allianz", "qbe"], "state": state}
    assert client.put(f"/projects/{PID}", json=body).status_code in (200, 201)
    yield client
    client.delete(f"/projects/{PID}")


def _grid(client) -> dict:
    res = client.get(f"/projects/{PID}/grid")
    assert res.status_code == 200, res.text
    return res.json()


def _cell(view: dict, col: str, key: str) -> dict:
    return next(c for c in view["columns"] if c["id"] == col)["cells"][key]


# ── Read ────────────────────────────────────────────────────────────────────

def test_grid_describes_the_16_rows_and_every_cell(project):
    view = _grid(project)
    keys = [f["key"] for f in view["fields"]]
    assert view["standard_field_count"] == 16
    assert keys[:16] == [
        "insurer", "type", "annual_turnover", "premium_rate", "estimated_annual_premium_exc_ipt",
        "minimum_annual_premium", "credit_limit_charges", "debt", "indemnity", "excess",
        "excess_type", "max_annual_liability", "discretionary_limit", "max_terms_of_payment",
        "max_extension_period", "additional_info",
    ]
    assert keys[16] == "waiting_period" and view["fields"][16]["extra"] is True
    assert [f["key"] for f in view["fields"] if f.get("gated")] == [
        "estimated_annual_premium_exc_ipt", "indemnity", "excess", "max_annual_liability"]
    assert view["policy_type"] == "Whole Turnover"
    assert [c["id"] for c in view["columns"]] == ["c-allianz", "c-exp", "c-free"]

    allianz = next(c for c in view["columns"] if c["id"] == "c-allianz")
    assert allianz["document_id"] == "doc-1" and allianz["pages"] == 3
    assert allianz["cells"]["insurer"] == {"value": "Allianz Trade", "orig": None, "page": None,
                                           "confidence": None, "provenance": "header",
                                           "source": None, "edited": False}
    assert allianz["cells"]["type"]["value"] == "Whole Turnover"          # from the project
    assert allianz["cells"]["type"]["source"] == "project"
    assert allianz["cells"]["debt"] == {"value": "Included", "orig": None, "page": None,
                                        "confidence": None, "provenance": "set",
                                        "source": "insurer_rule", "edited": False}
    assert allianz["cells"]["premium_rate"]["provenance"] == "extracted"
    assert allianz["cells"]["excess"]["confidence"] == "uncertain"
    assert allianz["cells"]["max_annual_liability"]["provenance"] == "blank"      # BRD 2.2: blank, not guessed
    assert allianz["cells"]["annual_turnover"]["provenance"] == "blank"
    assert allianz["cells"]["waiting_period"]["provenance"] == "blank"

    free = next(c for c in view["columns"] if c["id"] == "c-free")
    assert free["manual"] is True and free["cells"]["debt"]["value"] == ""      # no insurer → no rule

    assert view["confirmations"]["estimated_annual_premium_exc_ipt"]["confirmed"] is True
    assert view["gate"] == {"required": 4, "confirmed_count": 1, "complete": False,
                            "missing": ["indemnity", "excess", "max_annual_liability"]}
    assert view["reviewed"] is True and view["reviewed_at"] == 1_757_000_000_000

    fields = project.get(f"/projects/{PID}/grid/fields").json()
    assert [f["key"] for f in fields] == keys


# ── Cell edits ──────────────────────────────────────────────────────────────

def test_edit_keeps_the_original_clears_confirmation_and_review(project):
    res = project.patch(f"/projects/{PID}/grid/columns/c-allianz/cells/estimated_annual_premium_exc_ipt",
                        json={"value": "£12,500"})
    assert res.status_code == 200, res.text
    view = res.json()
    cell = _cell(view, "c-allianz", "estimated_annual_premium_exc_ipt")
    assert cell["value"] == "£12,500" and cell["orig"] == "£12,000"
    assert cell["provenance"] == "edited" and cell["edited"] is True
    assert cell["confidence"] == "high" and cell["page"] is None       # touched = human-verified
    assert view["confirmations"]["estimated_annual_premium_exc_ipt"]["confirmed"] is False   # re-confirm needed
    assert view["reviewed"] is False and view["reviewed_at"] is None

    # A non-gated edit does not touch the other flags; filling a blank
    # extracted row records an empty `orig`, so it counts as an edit (the
    # AI found nothing) exactly as the review screen does.
    project.put(f"/projects/{PID}/grid/confirmations/indemnity", json={"confirmed": True})
    view = project.patch(f"/projects/{PID}/grid/columns/c-allianz/cells/annual_turnover",
                         json={"value": "£4,000,000"}).json()
    cell = _cell(view, "c-allianz", "annual_turnover")
    assert cell["provenance"] == "edited" and cell["orig"] == ""
    # A free-format column has no AI baseline: its values are "manual".
    view = project.patch(f"/projects/{PID}/grid/columns/c-free/cells/excess", json={"value": "£1,000"}).json()
    assert _cell(view, "c-free", "excess")["provenance"] == "manual"
    assert view["confirmations"]["indemnity"]["confirmed"] is True

    # The persisted working document carries the same edit (one record).
    state = project.get(f"/projects/{PID}").json()["state"]
    col = next(c for c in state["columns"] if c["id"] == "c-allianz")
    assert col["data"]["estimated_annual_premium_exc_ipt"] == {"value": "£12,500", "orig": "£12,000",
                                                              "page": None, "conf": "high"}
    entries = project.get("/audit").json()["entries"]
    assert any(e["action"] == "grid.edit" and e["target"] == PID and
               "estimated_annual_premium_exc_ipt" in e["detail"] for e in entries)


def test_revert_restores_the_extracted_value(project):
    project.patch(f"/projects/{PID}/grid/columns/c-allianz/cells/indemnity", json={"value": "95%"})
    res = project.delete(f"/projects/{PID}/grid/columns/c-allianz/cells/indemnity")
    assert res.status_code == 200
    cell = _cell(res.json(), "c-allianz", "indemnity")
    assert cell["value"] == "90%" and cell["provenance"] == "extracted" and cell["edited"] is False
    # Nothing to revert: an untouched cell, a manual row, a set field.
    assert project.delete(f"/projects/{PID}/grid/columns/c-free/cells/indemnity").status_code == 409
    assert project.delete(f"/projects/{PID}/grid/columns/c-allianz/cells/waiting_period").status_code == 409
    assert project.delete(f"/projects/{PID}/grid/columns/c-allianz/cells/type").status_code == 409


def test_header_row_renames_the_column(project):
    view = project.patch(f"/projects/{PID}/grid/columns/c-free/cells/insurer",
                         json={"value": "  Lloyd's  syndicate "}).json()
    assert next(c for c in view["columns"] if c["id"] == "c-free")["name"] == "Lloyd's syndicate"
    assert project.patch(f"/projects/{PID}/grid/columns/c-free/cells/insurer",
                         json={"value": "   "}).status_code == 422


def test_unknown_column_or_field(project):
    assert project.patch(f"/projects/{PID}/grid/columns/nope/cells/excess",
                         json={"value": "x"}).status_code == 404
    res = project.patch(f"/projects/{PID}/grid/columns/c-allianz/cells/not_a_row", json={"value": "x"})
    assert res.status_code == 404 and "insurer" in res.json()["detail"]["fields"]
    assert project.get("/projects/none/grid").status_code == 404


# ── Set-field overrides ─────────────────────────────────────────────────────

def test_set_field_overrides_per_column(project):
    res = project.put(f"/projects/{PID}/grid/columns/c-allianz/set-fields/type", json={"value": "Top-Up"})
    assert res.status_code == 200, res.text
    cell = _cell(res.json(), "c-allianz", "type")
    assert cell["value"] == "Top-Up" and cell["source"] == "override" and cell["provenance"] == "set"
    # The other columns still inherit the project's policy type.
    assert _cell(res.json(), "c-exp", "type") == {"value": "Whole Turnover", "orig": None, "page": None,
                                                  "confidence": None, "provenance": "set",
                                                  "source": "project", "edited": False}

    assert project.put(f"/projects/{PID}/grid/columns/c-allianz/set-fields/type",
                       json={"value": "Excess of loss"}).status_code == 422
    assert project.put(f"/projects/{PID}/grid/columns/c-allianz/set-fields/debt",
                       json={"value": "Maybe"}).status_code == 422
    assert project.put(f"/projects/{PID}/grid/columns/c-allianz/set-fields/excess",
                       json={"value": "£1"}).status_code == 422                     # not a set field

    res = project.put(f"/projects/{PID}/grid/columns/c-allianz/set-fields/debt", json={"value": "Outsourced"})
    assert _cell(res.json(), "c-allianz", "debt")["source"] == "override"
    assert _cell(res.json(), "c-allianz", "debt")["value"] == "Outsourced"

    # Clearing goes back to the rule / project default.
    res = project.delete(f"/projects/{PID}/grid/columns/c-allianz/set-fields/debt")
    assert _cell(res.json(), "c-allianz", "debt") == {"value": "Included", "orig": None, "page": None,
                                                      "confidence": None, "provenance": "set",
                                                      "source": "insurer_rule", "edited": False}
    res = project.put(f"/projects/{PID}/grid/columns/c-allianz/set-fields/type", json={"value": ""})
    assert _cell(res.json(), "c-allianz", "type")["source"] == "project"
    # Editing a set field through the cell route is the same override.
    res = project.patch(f"/projects/{PID}/grid/columns/c-exp/cells/type", json={"value": "Single Risk"})
    assert _cell(res.json(), "c-exp", "type")["source"] == "override"


# ── Confirmations ───────────────────────────────────────────────────────────

def test_confirmations_are_gated_to_the_four_fields(project):
    res = project.get(f"/projects/{PID}/grid/confirmations")
    assert res.status_code == 200
    assert res.json()["gate"]["confirmed_count"] == 1

    res = project.put(f"/projects/{PID}/grid/confirmations/indemnity", json={"confirmed": True})
    assert res.status_code == 200, res.text
    conf = res.json()["confirmations"]["indemnity"]
    assert conf["confirmed"] is True and conf["by"] and conf["at"] > 0
    assert res.json()["gate"]["confirmed_count"] == 2

    assert project.put(f"/projects/{PID}/grid/confirmations/premium_rate",
                       json={"confirmed": True}).status_code == 422
    assert project.put(f"/projects/{PID}/grid/confirmations/type",
                       json={"confirmed": True}).status_code == 422

    res = project.put(f"/projects/{PID}/grid/confirmations",
                      json={"confirmed": {"excess": True, "max_annual_liability": True}})
    assert res.status_code == 200
    assert res.json()["gate"] == {"required": 4, "confirmed_count": 4, "complete": True, "missing": []}
    bad = project.put(f"/projects/{PID}/grid/confirmations",
                      json={"confirmed": {"excess": False, "premium_rate": True}})
    assert bad.status_code == 422 and bad.json()["detail"]["unknown"] == ["premium_rate"]
    assert _grid(project)["gate"]["complete"] is True                       # all-or-nothing: untouched

    res = project.put(f"/projects/{PID}/grid/confirmations/excess", json={"confirmed": False})
    assert res.json()["confirmations"]["excess"] == {"confirmed": False, "by": None, "at": None}
    assert res.json()["gate"]["missing"] == ["excess"]

    # The web app's shape is what is stored (confirmed.<key> booleans).
    state = project.get(f"/projects/{PID}").json()["state"]
    assert state["confirmed"] == {"premium": True, "indemnity": True, "excess": False, "maxLiability": True}
    assert state["confirmations"]["indemnity"]["by"]


def test_grid_endpoints_require_sign_in(anon_client):
    assert anon_client.get(f"/projects/{PID}/grid").status_code == 401
    assert anon_client.patch(f"/projects/{PID}/grid/columns/c/cells/excess", json={"value": "x"}).status_code == 401
    assert anon_client.put(f"/projects/{PID}/grid/confirmations/excess", json={"confirmed": True}).status_code == 401


def test_rules_module_is_pure():
    """The service returns a new state and never mutates the one it was given."""
    state = {"columns": [_column("c1", "QBE", matched="QBE")], "confirmed": {}, "reviewed": True}
    before = {"columns": [dict(state["columns"][0])], "confirmed": {}, "reviewed": True}
    nxt = grid.edit_cell(state, "Whole Turnover", "c1", "excess", "£1")
    assert nxt is not None and nxt["reviewed"] is False and state == before
    assert grid.edit_cell(state, "Whole Turnover", "c1", "excess", "£5,000") is None    # no change
    assert grid.set_confirmation(state, "excess", False, "x") is None                   # already off
