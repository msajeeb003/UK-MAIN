"""
Admin-maintained configuration (BRD 2.3/2.4 "configuration, not code"):
the standing insurer list with its debt-collection rule, and the
terminology map (insurer wording → standard field). Stored as versioned
documents in the relational store so an admin can change them from the
app, without a deploy; the repository's config/*.json files remain the
seed used until the first save. app/services/library.py reads through
this module and every pipeline run picks up the current version.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.engine import session_scope
from app.db.models import ConfigDocument, utcnow

logger = logging.getLogger(__name__)

INSURERS = "insurers"
TERMINOLOGY = "terminology"
DOCUMENTS = (INSURERS, TERMINOLOGY)

# The 16 standard terms the AI extracts and the terminology map may target:
# the twelve quote terms plus the four credit-limit schedule columns. The
# set fields (type of policy, debt collection), the insurer header and the
# free-format notes take no insurer wording.
TERM_FIELDS: tuple[str, ...] = (
    "annual_turnover", "premium_rate", "estimated_annual_premium_exc_ipt",
    "minimum_annual_premium", "credit_limit_charges", "indemnity", "excess", "excess_type",
    "max_annual_liability", "discretionary_limit", "max_terms_of_payment",
    "max_extension_period", "buyer_name", "company_number", "limit_required", "limit_offered",
)
DEBT_VALUES = ("included", "outsourced")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")


class ConfigInvalid(ValueError):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


# ── Validation / normalisation ─────────────────────────────────────────────

def _clean(value: Any) -> str:
    return " ".join(str(value).split()) if isinstance(value, str) else ""


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        key = v.lower()
        if key and key not in seen:
            seen.add(key)
            out.append(v)
    return out


def normalise_insurers(doc: dict) -> dict:
    """Validate an insurers document and return its canonical form:
    {"insurers": [{id, name, legal_names, debt_collection, active}]}.
    Legacy `aliases` (the repository file's shape) are folded into
    `legal_names`."""
    errors: list[str] = []
    raw = doc.get("insurers") if isinstance(doc, dict) else None
    if not isinstance(raw, list) or not raw:
        raise ConfigInvalid(["`insurers` must be a non-empty list."])
    legacy_aliases = doc.get("aliases") if isinstance(doc.get("aliases"), dict) else {}
    ids: set[str] = set()
    names: dict[str, str] = {}          # lowercased name -> insurer id (uniqueness)
    out: list[dict] = []
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict):
            errors.append(f"insurers[{i}]: must be an object.")
            continue
        ins_id = _clean(entry.get("id")).lower()
        name = _clean(entry.get("name"))
        where = f"insurers[{i}] ({ins_id or name or '?'})"
        if not _ID_RE.match(ins_id):
            errors.append(f"{where}: id must be a slug (a-z, 0-9, - or _, up to 40 chars).")
        elif ins_id in ids:
            errors.append(f"{where}: duplicate id.")
        ids.add(ins_id)
        if not name:
            errors.append(f"{where}: canonical name is required.")
        legal = entry.get("legal_names")
        legal_list = [_clean(v) for v in legal] if isinstance(legal, list) else []
        legal_list += [_clean(v) for v in legacy_aliases.get(ins_id, []) if isinstance(v, str)]
        legal_list = [v for v in _dedupe(legal_list) if v.lower() != name.lower()]
        for n in [name, *legal_list]:
            key = n.lower()
            if key and key in names and names[key] != ins_id:
                errors.append(f"{where}: name '{n}' is already used by '{names[key]}'.")
            elif key:
                names[key] = ins_id
        debt = _clean(entry.get("debt_collection")).lower()
        if debt not in DEBT_VALUES:
            errors.append(f"{where}: debt_collection must be 'included' or 'outsourced'.")
        active = entry.get("active", True)
        if not isinstance(active, bool):
            errors.append(f"{where}: active must be true or false.")
            active = True
        # Optional per-insurer wording for the set field (Feedback Round 1,
        # B1): shown in place of Included / Outsourced for that insurer.
        label = entry.get("debt_collection_label")
        label = _clean(label) if isinstance(label, str) else ""
        if len(label) > 60:
            errors.append(f"{where}: debt_collection_label must be 60 characters or fewer.")
        record = {"id": ins_id, "name": name, "legal_names": legal_list,
                  "debt_collection": debt, "active": active}
        if label:
            record["debt_collection_label"] = label
        out.append(record)
    if out and not any(i["active"] for i in out):
        errors.append("At least one insurer must be active.")
    if errors:
        raise ConfigInvalid(errors)
    return {"insurers": out}


def _normalise_rules(raw_rules, insurer_ids: set[str], errors: list[str]) -> dict:
    """Wording rules (B3): {insurer id | '*': {field: [{match, render}]}}.
    Every regex must compile and every {placeholder} in the render
    template must be a named group of its regex."""
    if raw_rules is None:
        return {}
    if not isinstance(raw_rules, dict):
        errors.append("rules: must be an object of insurer id → {field: [rules]}.")
        return {}
    out: dict[str, dict[str, list[dict]]] = {}
    for ins_id, section in raw_rules.items():
        if ins_id != "*" and ins_id not in insurer_ids:
            errors.append(f"rules.{ins_id}: unknown insurer id.")
            continue
        if not isinstance(section, dict):
            errors.append(f"rules.{ins_id}: must be an object of field → [rules].")
            continue
        fields: dict[str, list[dict]] = {}
        for field, items in section.items():
            where = f"rules.{ins_id}.{field}"
            if field not in TERM_FIELDS:
                errors.append(f"{where}: '{field}' is not one of the 16 standard fields.")
                continue
            if not isinstance(items, list):
                errors.append(f"{where}: must be a list of {{match, render}} rules.")
                continue
            cleaned = []
            for i, rule in enumerate(items):
                match = rule.get("match") if isinstance(rule, dict) else None
                render = rule.get("render") if isinstance(rule, dict) else None
                if not isinstance(match, str) or not match.strip() or not isinstance(render, str):
                    errors.append(f"{where}[{i}]: needs a 'match' regex and a 'render' template.")
                    continue
                try:
                    compiled = re.compile(match, re.IGNORECASE)
                except re.error as exc:
                    errors.append(f"{where}[{i}]: invalid regex ({exc}).")
                    continue
                missing = [ph for ph in re.findall(r"\{(\w+)\}", render) if ph not in compiled.groupindex]
                if missing:
                    errors.append(f"{where}[{i}]: render uses {missing} which are not named groups of the regex.")
                    continue
                cleaned.append({"match": match, "render": render.strip()})
            if cleaned:
                fields[field] = cleaned
        if fields:
            out[ins_id] = fields
    return out


def normalise_terminology(doc: dict, insurer_ids: set[str]) -> dict:
    """Validate a terminology document and return its canonical form:
    {"fields": {standard field: [terms]}, "insurers": {insurer id:
    {standard field: [terms]}}}. Every field key must be one of the 16
    standard terms; insurer keys must be standing-list ids."""
    errors: list[str] = []
    if not isinstance(doc, dict):
        raise ConfigInvalid(["The terminology document must be an object."])

    def terms_map(section: Any, where: str) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        if section is None:
            return out
        if not isinstance(section, dict):
            errors.append(f"{where}: must be an object of standard field → list of terms.")
            return out
        for field, terms in section.items():
            if field not in TERM_FIELDS:
                errors.append(f"{where}: '{field}' is not one of the 16 standard fields.")
                continue
            if not isinstance(terms, list) or not all(isinstance(t, str) for t in terms):
                errors.append(f"{where}.{field}: must be a list of strings.")
                continue
            out[field] = _dedupe([_clean(t) for t in terms])
        return out

    fields = terms_map(doc.get("fields"), "fields")
    insurers: dict[str, dict[str, list[str]]] = {}
    raw_insurers = doc.get("insurers")
    if raw_insurers is not None:
        if not isinstance(raw_insurers, dict):
            errors.append("insurers: must be an object of insurer id → {field: [terms]}.")
        else:
            for ins_id, section in raw_insurers.items():
                if ins_id not in insurer_ids:
                    errors.append(f"insurers.{ins_id}: unknown insurer id.")
                    continue
                mapped = terms_map(section, f"insurers.{ins_id}")
                if mapped:
                    insurers[ins_id] = {k: v for k, v in mapped.items() if v}
    rules = _normalise_rules(doc.get("rules"), insurer_ids, errors)
    if errors:
        raise ConfigInvalid(errors)
    return {"fields": {f: fields.get(f, []) for f in TERM_FIELDS}, "insurers": insurers,
            "rules": rules}


def merged_terminology(doc: dict) -> dict[str, list[str]]:
    """field → every term seen for it (global first, then per insurer) —
    the view the extraction prompt uses."""
    merged: dict[str, list[str]] = {}
    for field in TERM_FIELDS:
        terms = list(doc.get("fields", {}).get(field, []))
        for section in (doc.get("insurers") or {}).values():
            terms += section.get(field, [])
        merged[field] = _dedupe(terms)
    return merged


# ── Persistence ────────────────────────────────────────────────────────────

def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _meta(row: ConfigDocument | None) -> dict:
    if row is None:
        return {"version": 0, "updated_by": None, "updated_at": None, "source": "file"}
    return {"version": row.version, "updated_by": row.updated_by,
            "updated_at": _aware(row.updated_at), "source": "database"}


def version(name: str) -> int:
    """Cheap freshness probe (0 = never saved; the seed file applies)."""
    with session_scope() as session:
        return session.scalar(select(ConfigDocument.version).where(ConfigDocument.name == name)) or 0


def get(name: str) -> tuple[dict | None, dict]:
    """(data, meta) — data is None until an admin has saved the document."""
    with session_scope() as session:
        row = session.get(ConfigDocument, name)
        return (dict(row.data) if row else None), _meta(row)


def save(name: str, data: dict, actor: str) -> dict:
    """Store a validated document as the next version. Returns its meta."""
    assert name in DOCUMENTS  # noqa: S101 — programmer error
    with session_scope() as session:
        row = session.get(ConfigDocument, name)
        if row is None:
            row = ConfigDocument(name=name, data=data, version=1, updated_by=actor, updated_at=utcnow())
            session.add(row)
        else:
            row.data = data
            row.version += 1
            row.updated_by = actor
            row.updated_at = utcnow()
        session.flush()
        meta = _meta(row)
    from app.services import library
    library.invalidate()                 # this process sees the change at once
    return meta


def seed_from_file(session: Session, name: str, data: dict) -> None:  # pragma: no cover - utility
    if session.get(ConfigDocument, name) is None:
        session.add(ConfigDocument(name=name, data=data, version=1, updated_by="seed", updated_at=utcnow()))
