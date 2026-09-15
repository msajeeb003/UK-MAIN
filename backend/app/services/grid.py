"""
Comparison grid (BRD 2.3 / 2.4 / 2.5, S5): the 16 standard rows × one
column per insurer quote, over the project's working document (`state`).

The grid is not a separate table: the columns and cells the broker reviews
live in `state.columns` / `state.confirmed`, exactly as the web app stores
them, so server-side edits and the screen's own autosave describe the same
document. This module holds the rules; the API (app/api/grid.py) is a thin
HTTP layer over it.

Row kinds
- `header`    — the insurer row: the column's name (matched insurer).
- `extracted` — read by the AI from the quote; the original value is kept
                as `orig` so an edit can be reverted and the edit rate
                measured (BRD §5).
- `set`       — never extracted (BRD 2.4): type of policy comes from the
                project setup, debt collection from the insurer rule; each
                can be overridden per column.
- `manual`    — broker-entered only (waiting period): no AI baseline.

Gate (BRD 2.5): four rows must be confirmed before the presentation can be
generated. Editing one of them clears its confirmation; any grid change
clears the "reviewed all columns" tick.
"""

from __future__ import annotations

import time
from typing import Any

from app.services.library import debt_collection_options, debt_collection_rule

POLICY_TYPES = ("Whole Turnover", "Top-Up", "Single Risk", "Gap-Fill")

# confirm key (as stored in state.confirmed, shared with the web) ↔ field key
CONFIRM_KEYS: dict[str, str] = {
    "premium": "estimated_annual_premium_exc_ipt",
    "indemnity": "indemnity",
    "excess": "excess",
    "maxLiability": "max_annual_liability",
}
GATED_FIELDS: dict[str, str] = {field: key for key, field in CONFIRM_KEYS.items()}

FIELDS: list[dict[str, Any]] = [
    {"key": "insurer", "label": "Insurer", "kind": "header"},
    {"key": "type", "label": "Type of Policy", "kind": "set", "set_source": "project",
     "note": "Set at setup · overridable per column"},
    {"key": "annual_turnover", "label": "Insurable Turnover", "kind": "extracted"},
    {"key": "premium_rate", "label": "Premium Rate", "kind": "extracted"},
    {"key": "estimated_annual_premium_exc_ipt", "label": "Annual Premium", "kind": "extracted",
     "note": "Estimated · excl. IPT", "gated": "premium"},
    {"key": "minimum_annual_premium", "label": "Minimum Premium", "kind": "extracted", "note": "Excl. IPT"},
    {"key": "credit_limit_charges", "label": "Credit Limit Charges", "kind": "extracted", "note": "Excl. VAT"},
    {"key": "debt", "label": "Debt Collection", "kind": "set", "set_source": "insurer_rule",
     "note": "Set by insurer rule"},
    {"key": "indemnity", "label": "Indemnity", "kind": "extracted", "gated": "indemnity"},
    {"key": "excess", "label": "Excess", "kind": "extracted", "gated": "excess"},
    {"key": "excess_type", "label": "Excess Type", "kind": "extracted", "note": "Insurer's own term"},
    {"key": "max_annual_liability", "label": "Max Liability", "kind": "extracted", "note": "Annual",
     "gated": "maxLiability"},
    {"key": "discretionary_limit", "label": "Discretionary Limit", "kind": "extracted"},
    {"key": "max_terms_of_payment", "label": "Max Terms of Payment", "kind": "extracted"},
    {"key": "max_extension_period", "label": "Max Extension Period", "kind": "extracted"},
    # Broker-written free text (Feedback Round 1, B5): never extracted.
    {"key": "additional_info", "label": "Notes", "kind": "manual", "note": "Free-format · broker-entered"},
    # Not in the BRD's 16 — a broker-entered row the review screen carries
    # (flagged to the client); kept here so the API describes what is stored.
    {"key": "waiting_period", "label": "Waiting Period", "kind": "manual", "note": "Broker-entered",
     "extra": True},
]
FIELD_BY_KEY: dict[str, dict[str, Any]] = {f["key"]: f for f in FIELDS}
STANDARD_FIELD_COUNT = sum(1 for f in FIELDS if not f.get("extra"))


class ColumnNotFound(LookupError):
    pass


class FieldNotFound(LookupError):
    pass


class NotASetField(ValueError):
    pass


class NotGated(ValueError):
    pass


class InvalidValue(ValueError):
    pass


class NothingToRevert(ValueError):
    pass


# ── Reading ────────────────────────────────────────────────────────────────

def columns(state: dict) -> list[dict]:
    cols = state.get("columns")
    return [c for c in cols if isinstance(c, dict) and c.get("id")] if isinstance(cols, list) else []


def find_column(state: dict, column_id: str) -> dict:
    for col in columns(state):
        if col["id"] == column_id:
            return col
    raise ColumnNotFound(column_id)


def field(key: str) -> dict:
    try:
        return FIELD_BY_KEY[key]
    except KeyError as exc:
        raise FieldNotFound(key) from exc


def _cell_data(col: dict, key: str) -> dict | None:
    data = col.get("data")
    sv = data.get(key) if isinstance(data, dict) else None
    return sv if isinstance(sv, dict) else None


def _rule_debt(col: dict) -> str:
    """BRD 2.4 default: the value the upload stored from the insurer rule,
    else the rule applied to the column's insurer now (an unrecognised
    insurer defaults to Outsourced). A free-format column has no insurer."""
    stored = col.get("debt")
    if isinstance(stored, str) and stored:
        return stored
    if col.get("manual"):
        return ""
    value, _matched = debt_collection_rule(col.get("matched") or col.get("name"))
    return value


def cell_value(project_policy_type: str | None, col: dict, key: str) -> str:
    """Effective text in a cell; set fields fall back to the project / rule."""
    f = field(key)
    if f["kind"] == "header":
        return str(col.get("name") or "")
    sv = _cell_data(col, key)
    if key == "type":
        own = sv.get("value") if sv else None
        return str(own) if own else str(project_policy_type or "")
    if key == "debt":
        own = sv.get("value") if sv else None
        return str(own) if own is not None else _rule_debt(col)
    return str(sv.get("value") or "") if sv else ""


def _is_edited(col: dict, key: str) -> bool:
    sv = _cell_data(col, key)
    return bool(sv and "orig" in sv and (sv.get("orig") or "") != (sv.get("value") or ""))


def cell_view(project_policy_type: str | None, col: dict, key: str) -> dict:
    f = field(key)
    sv = _cell_data(col, key) or {}
    value = cell_value(project_policy_type, col, key)
    if f["kind"] == "header":
        provenance, source = "header", None
    elif f["kind"] == "set":
        own = sv.get("value")
        overridden = bool(own) if key == "type" else own is not None
        provenance = "set"
        source = "override" if overridden else f["set_source"]
    elif value == "":
        provenance, source = "blank", None
    elif _is_edited(col, key):
        provenance, source = "edited", None
    elif col.get("manual") or f["kind"] == "manual" or "orig" not in sv or not (sv.get("orig") or ""):
        provenance, source = "manual", None
    else:
        provenance, source = "extracted", None
    return {
        "value": value,
        "orig": sv.get("orig") if "orig" in sv else None,
        "page": sv.get("page") if isinstance(sv.get("page"), int) else None,
        "confidence": sv.get("conf") if isinstance(sv.get("conf"), str) else None,
        "provenance": provenance,
        "source": source,
        "edited": provenance == "edited",
    }


def confirmations(state: dict) -> dict[str, dict]:
    flags = state.get("confirmed") if isinstance(state.get("confirmed"), dict) else {}
    meta = state.get("confirmations") if isinstance(state.get("confirmations"), dict) else {}
    out: dict[str, dict] = {}
    for ckey, fkey in CONFIRM_KEYS.items():
        on = bool(flags.get(ckey))
        m = meta.get(ckey) if isinstance(meta.get(ckey), dict) else {}
        out[fkey] = {
            "confirmed": on,
            "by": m.get("by") if on else None,
            "at": m.get("at") if on else None,
        }
    return out


def gate(state: dict) -> dict:
    conf = confirmations(state)
    missing = [fkey for fkey, c in conf.items() if not c["confirmed"]]
    return {"required": len(CONFIRM_KEYS), "confirmed_count": len(CONFIRM_KEYS) - len(missing),
            "complete": not missing, "missing": missing}


def grid_view(project_id: str, project_policy_type: str | None, state: dict) -> dict:
    cols = []
    for col in columns(state):
        cols.append({
            "id": col["id"],
            "name": str(col.get("name") or ""),
            "matched": col.get("matched") or None,
            "expiring": bool(col.get("expiring")),
            "manual": bool(col.get("manual")),
            "document_id": col.get("docId") or None,
            "pages": col.get("pages") if isinstance(col.get("pages"), int) else None,
            "cells": {f["key"]: cell_view(project_policy_type, col, f["key"]) for f in FIELDS},
        })
    return {
        "project_id": project_id,
        "policy_type": project_policy_type,
        "fields": [dict(f) for f in FIELDS],
        "standard_field_count": STANDARD_FIELD_COUNT,
        "columns": cols,
        "confirmations": confirmations(state),
        "gate": gate(state),
        "reviewed": bool(state.get("reviewed")),
        "reviewed_at": state.get("reviewedAt") if isinstance(state.get("reviewedAt"), int | float) else None,
    }


# ── Mutations (return a NEW state dict; None means nothing changed) ─────────

def _now_ms() -> int:
    return int(time.time() * 1000)


def _touch(state: dict) -> dict:
    """Any grid change invalidates the review tick and bumps `updated`."""
    next_state = dict(state)
    next_state["updated"] = _now_ms()
    if next_state.get("reviewed"):
        next_state["reviewed"] = False
        next_state.pop("reviewedAt", None)
    return next_state


def _unconfirm(state: dict, key: str) -> None:
    ckey = GATED_FIELDS.get(key)
    if not ckey:
        return
    flags = dict(state.get("confirmed") or {})
    flags[ckey] = False
    state["confirmed"] = flags
    meta = dict(state.get("confirmations") or {})
    meta.pop(ckey, None)
    state["confirmations"] = meta


def _replace_column(state: dict, column: dict) -> dict:
    next_state = _touch(state)
    next_state["columns"] = [column if c.get("id") == column["id"] else c for c in columns(state)]
    return next_state


def _validate_set_value(key: str, value: str) -> str:
    value = " ".join(value.split())
    if key == "type" and value and value not in POLICY_TYPES:
        raise InvalidValue(f"Type of policy must be one of: {', '.join(POLICY_TYPES)}.")
    if key == "debt" and value and value not in debt_collection_options():
        raise InvalidValue(f"Debt collection must be one of: {', '.join(debt_collection_options())}.")
    return value


def edit_cell(state: dict, project_policy_type: str | None, column_id: str, key: str,
              value: str) -> dict | None:
    """The broker types a value into a cell (mirrors the review screen):
    the AI's original is kept as `orig`, touching the cell counts as human
    verification (confidence high), a gated row loses its confirmation."""
    f = field(key)
    col = find_column(state, column_id)
    if f["kind"] == "set":
        return set_override(state, column_id, key, value)
    if f["kind"] == "header":
        name = " ".join(value.split())
        if not name:
            raise InvalidValue("The insurer name cannot be blank.")
        if name == (col.get("name") or ""):
            return None
        return _replace_column(state, {**col, "name": name})

    if cell_value(project_policy_type, col, key) == value:
        return None
    prev = _cell_data(col, key)
    cell: dict[str, Any] = {"value": value, "page": None, "conf": "high"}
    if prev and "orig" in prev:
        cell["orig"] = prev["orig"]
    elif f["kind"] == "extracted" and not col.get("manual"):
        cell["orig"] = (prev or {}).get("value") or ""
    data = dict(col.get("data") or {})
    data[key] = cell
    next_state = _replace_column(state, {**col, "data": data})
    _unconfirm(next_state, key)
    return next_state


def revert_cell(state: dict, column_id: str, key: str) -> dict | None:
    """Put the AI's original value back (undo the broker's edit)."""
    f = field(key)
    col = find_column(state, column_id)
    if f["kind"] != "extracted":
        raise NothingToRevert("Only extracted values have an original to revert to.")
    prev = _cell_data(col, key)
    if not prev or "orig" not in prev:
        raise NothingToRevert("No extracted value to revert to.")
    if (prev.get("value") or "") == (prev.get("orig") or ""):
        return None
    data = dict(col.get("data") or {})
    data[key] = {**prev, "value": prev.get("orig") or ""}
    next_state = _replace_column(state, {**col, "data": data})
    _unconfirm(next_state, key)
    return next_state


def set_override(state: dict, column_id: str, key: str, value: str) -> dict | None:
    """Per-column override of a set field; an empty value clears it so the
    project default (type) or the insurer rule (debt) shows again."""
    f = field(key)
    if f["kind"] != "set":
        raise NotASetField(key)
    col = find_column(state, column_id)
    value = _validate_set_value(key, value)
    data = dict(col.get("data") or {})
    current = _cell_data(col, key)
    if not value:
        if key not in data:
            return None
        data.pop(key, None)
    else:
        if current and current.get("value") == value:
            return None
        data[key] = {"value": value}
    return _replace_column(state, {**col, "data": data})


def clear_override(state: dict, column_id: str, key: str) -> dict | None:
    return set_override(state, column_id, key, "")


def set_confirmation(state: dict, key: str, on: bool, actor: str) -> dict | None:
    """Confirm (or unconfirm) one of the four gated rows (BRD 2.5)."""
    ckey = GATED_FIELDS.get(key)
    if not ckey:
        raise NotGated(key)
    flags = dict(state.get("confirmed") or {})
    if bool(flags.get(ckey)) == on:
        return None
    flags[ckey] = on
    meta = dict(state.get("confirmations") or {})
    if on:
        meta[ckey] = {"by": actor, "at": _now_ms()}
    else:
        meta.pop(ckey, None)
    next_state = dict(state)
    next_state["confirmed"] = flags
    next_state["confirmations"] = meta
    next_state["updated"] = _now_ms()
    return next_state
