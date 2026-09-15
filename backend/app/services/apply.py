"""
Persist step of the document pipeline: fold one document's extraction
into the project's working document (`state`) — the comparison column for
a quote / expiring policy, the buyer rows for a credit-limit schedule, and
the upload card in `state.files`.

Rules (BRD 2.1 / 2.4 / 2.5, mirrored from the S4 screen's former
client-side apply, plus the idempotency rule of ART-330):

- One automatic column per insurer. A re-run of the same document (same
  `docId`) or a newer upload for the same insurer UPDATES that column in
  place, keeping its id so the recommendation and credit-limit offers stay
  linked.
- A re-run overwrites the document's *extractions only*: a cell the broker
  edited keeps the broker's value (the new AI value becomes its `orig`),
  set-field overrides and broker-entered rows are untouched, and an offer
  the broker typed is not replaced by the schedule's figure.
- A credit-limit schedule never becomes a column; its offers attach to the
  insurer's column, or wait as `pending` until that column exists.
- A new or refreshed column changes the comparison, so the four
  confirmations and the review tick are cleared.
"""

from __future__ import annotations

import secrets
import time
from typing import Any

from app.models.schemas import ExtractionResponse

EXTRACTED_FIELD_KEYS = (
    "annual_turnover", "premium_rate", "estimated_annual_premium_exc_ipt",
    "minimum_annual_premium", "credit_limit_charges", "indemnity", "excess", "excess_type",
    "max_annual_liability", "discretionary_limit", "max_terms_of_payment",
    "max_extension_period", "additional_info",
)
DOC_TYPE_LABELS = {
    "insurer_quote": "quote", "credit_limit_schedule": "credit-limit schedule",
    "policy_document": "policy document", "other": "document",
}
KIND_LABELS = {"limits": "credit-limit doc", "expiring": "expiring policy", "quote": "quote"}


def _lower(s: Any) -> str:
    return str(s or "").lower()


def _uid() -> str:
    return secrets.token_hex(6)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _files(state: dict) -> list[dict]:
    f = state.get("files")
    return [x for x in f if isinstance(x, dict) and x.get("id")] if isinstance(f, list) else []


def _columns(state: dict) -> list[dict]:
    c = state.get("columns")
    return [x for x in c if isinstance(x, dict) and x.get("id")] if isinstance(c, list) else []


def _credit(state: dict) -> list[dict]:
    c = state.get("credit")
    return [x for x in c if isinstance(x, dict) and x.get("id")] if isinstance(c, list) else []


# ── Upload cards (state.files) ─────────────────────────────────────────────

def file_entry(document_id: str, filename: str, slot: str, *, status: str, meta: str,
               job_id: str | None) -> dict:
    ext = filename.rsplit(".", 1)[-1].upper() if "." in filename else "FILE"
    return {"id": document_id, "name": filename, "kind": slot, "ext": ext[:5], "status": status,
            "meta": meta, "jobId": job_id, "docId": document_id, "colId": None, "addedAt": _now_ms()}


def upsert_file_entry(state: dict, entry: dict) -> dict:
    """Add the card for a new upload. Replaces an earlier card for the same
    slot + filename (a re-upload), and — the expiring policy being a single
    slot — any other expiring-policy card."""
    kept = [
        f for f in _files(state)
        if f.get("docId") != entry["docId"] and f.get("id") != entry["id"]
        and not (f.get("kind") == entry["kind"] and f.get("name") == entry["name"])
        and not (entry["kind"] == "expiring" and f.get("kind") == "expiring")
    ]
    return {**state, "files": [*kept, entry], "updated": _now_ms()}


def set_file_status(state: dict, document_id: str, *, status: str, meta: str,
                    job_id: str | None = None, col_id: str | None = None, clear_job: bool = False) -> dict:
    files = []
    for f in _files(state):
        if f.get("docId") == document_id or f.get("id") == document_id:
            nxt = {**f, "status": status, "meta": meta}
            nxt.pop("progress", None)
            if job_id is not None:
                nxt["jobId"] = job_id
            if clear_job:
                nxt["jobId"] = None
            if col_id is not None:
                nxt["colId"] = col_id
            files.append(nxt)
        else:
            files.append(f)
    return {**state, "files": files, "updated": _now_ms()}


def remove_file_entry(state: dict, document_id: str) -> dict:
    files = [f for f in _files(state) if f.get("docId") != document_id and f.get("id") != document_id]
    return {**state, "files": files, "updated": _now_ms()}


# ── Credit-limit rows ──────────────────────────────────────────────────────

def _merge_buyers(credit: list[dict], col_id: str | None, buyers: list, pend_key: str | None) -> list[dict]:
    rows = [{**r, "offers": dict(r.get("offers") or {}),
             **({"pending": dict(r["pending"])} if r.get("pending") else {})} for r in credit]
    for b in buyers or []:
        name, reg = b.buyer_name or "", b.company_number or ""
        if not name and not reg:
            continue
        row = next((r for r in rows if (reg and r.get("reg") == reg)
                    or (name and _lower(r.get("buyer")) == _lower(name))), None)
        if row is None:
            row = {"id": _uid(), "buyer": name, "reg": reg, "req": "", "offers": {}}
            rows.append(row)
        edited = row.get("edited") or {}
        if not row.get("reg") and reg:
            row["reg"] = reg
        if not row.get("req") and b.limit_required:
            row["req"] = b.limit_required
        if col_id and b.limit_offered:
            if not edited.get(col_id):                 # the broker's figure wins
                row["offers"][col_id] = b.limit_offered
        elif pend_key and b.limit_offered:
            row["pending"] = {**(row.get("pending") or {}), pend_key: b.limit_offered}
    return rows


def _attach_pending(credit: list[dict], col: dict) -> list[dict]:
    keys = [_lower(k) for k in (col.get("matched"), col.get("name")) if k]
    out = []
    for row in credit:
        pending = dict(row.get("pending") or {})
        if not pending:
            out.append(row)
            continue
        offers = dict(row.get("offers") or {})
        for key in list(pending):
            if any(k == key or key in k or k in key for k in keys):
                if not offers.get(col["id"]):
                    offers[col["id"]] = pending[key]
                pending.pop(key)
        nxt = {**row, "offers": offers}
        if pending:
            nxt["pending"] = pending
        else:
            nxt.pop("pending", None)
        out.append(nxt)
    return out


def _find_insurer_column(columns: list[dict], matched: str | None, insurer: str | None) -> dict | None:
    if matched:
        hit = next((c for c in columns if c.get("matched") == matched), None)
        if hit:
            return hit
    if insurer:
        return next((c for c in columns
                     if _lower(insurer) in _lower(c.get("name")) or _lower(c.get("name")) in _lower(insurer)), None)
    return None


# ── Cells ──────────────────────────────────────────────────────────────────

def _merge_cells(existing: dict | None, result: ExtractionResponse) -> dict:
    """Fresh AI values for the extracted rows, keeping the broker's edits
    (value ≠ orig) and every non-extracted key (set-field overrides, the
    broker-entered waiting period)."""
    data = dict((existing or {}).get("data") or {})
    extracted = result.data.model_dump()
    for key in EXTRACTED_FIELD_KEYS:
        sv = extracted.get(key)
        if not isinstance(sv, dict):
            continue
        ai_value = sv.get("value") or ""
        fresh = {"value": ai_value, "orig": ai_value, "page": sv.get("page"), "conf": sv.get("confidence")}
        prev = data.get(key)
        if isinstance(prev, dict) and "orig" in prev and (prev.get("value") or "") != (prev.get("orig") or ""):
            fresh["value"] = prev.get("value") or ""     # broker edit survives the re-run
        data[key] = fresh
    return data


# ── Main entry ─────────────────────────────────────────────────────────────

def apply_result(state: dict, *, document_id: str, filename: str, slot: str,
                 result: ExtractionResponse) -> tuple[dict, str | None]:
    """Fold `result` into `state`. Returns (new state, column id or None)."""
    d = result.data
    insurer = d.insurer.value or None
    matched = result.set_fields.debt_collection_support.matched_insurer if result.set_fields else None
    uncertain = len(result.review.uncertain_fields) if result.review else 0
    columns = list(_columns(state))
    credit = _credit(state)

    match_note = f" (matched: {matched})" if matched and insurer and _lower(matched) != _lower(insurer) else ""
    pages = result.meta.page_count
    meta = (
        (insurer or "Unrecognised insurer") + match_note + " · "
        + (DOC_TYPE_LABELS.get(d.document_type) or KIND_LABELS.get(slot, "document"))
        + (" (scanned)" if result.meta.extraction_engine in ("azure_document_intelligence", "docling") else "")
        + f" · {pages} page{'' if pages == 1 else 's'}"
        + (f" · {uncertain} value{'' if uncertain == 1 else 's'} to verify" if uncertain else "")
    )

    # Credit-limit schedules attach to the insurer's column, never become one.
    if slot == "limits" or d.document_type == "credit_limit_schedule":
        col = _find_insurer_column(columns, matched, insurer)
        credit = _merge_buyers(credit, col["id"] if col else None, d.buyer_credit_limits,
                               _lower(matched or insurer or "") or None)
        if col:
            meta += f" · limits added to {col['name']}"
        nxt = {**state, "credit": credit}
        nxt = set_file_status(nxt, document_id, status="extracted", meta=meta, clear_job=True)
        return nxt, None

    rule_debt = result.set_fields.debt_collection_support.value if result.set_fields else "Outsourced"
    col_name = (f"Expiring — {insurer or 'policy'}" if slot == "expiring"
                else insurer or (filename.rsplit(".", 1)[0] if filename else "Quote"))

    # Same document re-run → its own column; else the insurer's column.
    existing = next((c for c in columns if c.get("docId") == document_id and not c.get("manual")), None)
    if existing is None:
        existing = next((c for c in columns if not c.get("manual") and _lower(c.get("name")) == _lower(col_name)), None)

    if existing is not None:
        updated = {**existing, "data": _merge_cells(existing, result), "debt": rule_debt, "matched": matched,
                   "docId": document_id, "pages": pages, "fileName": filename, "name": existing.get("name") or col_name}
        columns = [updated if c["id"] == existing["id"] else c for c in columns]
        col_id = existing["id"]
        meta += " · updated existing column"
        credit = _attach_pending(_merge_buyers(credit, col_id, d.buyer_credit_limits, None), updated)
    else:
        col = {"id": _uid(), "name": col_name, "manual": False, "expiring": slot == "expiring",
               "fileName": filename, "docId": document_id, "pages": pages,
               "data": _merge_cells(None, result), "debt": rule_debt, "matched": matched}
        columns = [col, *columns] if slot == "expiring" else [*columns, col]
        col_id = col["id"]
        credit = _attach_pending(_merge_buyers(credit, col_id, d.buyer_credit_limits, None), col)

    nxt = {**state, "columns": columns, "credit": credit,
           "confirmed": {}, "confirmations": {}, "reviewed": False}
    nxt.pop("reviewedAt", None)
    nxt = set_file_status(nxt, document_id, status="extracted", meta=meta, col_id=col_id, clear_job=True)
    return nxt, col_id
