"""Mapping library + insurer rules (BRD 2.3/2.4) — configuration, not code.

Two sources, checked in order:
1. The admin-saved documents in the relational store
   (app/services/config_store.py) — maintained from the app, no deploy.
2. The repository's config/insurers.json and config/terminology.json, the
   seed used until the first save (re-read on mtime change).

Readers cache the current version and re-check the store at most every
few seconds, so every gunicorn worker picks up an admin change for its
next pipeline run; the saving process is refreshed immediately.
"""

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any

from app.core.errors import ConfigurationError

logger = logging.getLogger(__name__)

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config"
_RECHECK_SECONDS = 2.0

_lock = threading.Lock()
_file_cache: dict[str, tuple[float, Any]] = {}        # filename -> (mtime, parsed)
_store_cache: dict[str, tuple[int, Any, float]] = {}  # name -> (version, data|None, checked_at)


def _load_json(filename: str) -> Any:
    """Read a seed config file, caching by modification time (thread-safe)."""
    path = CONFIG_DIR / filename
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError as exc:
        raise ConfigurationError(
            f"config/{filename} is missing — restore it from the repository."
        ) from exc
    with _lock:
        cached = _file_cache.get(filename)
        if cached and cached[0] == mtime:
            return cached[1]
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            # A stale cached copy is safer than crashing mid-edit; fall back
            # if we have one, otherwise surface a clear operator error.
            if cached:
                logger.error(
                    "config/%s is invalid JSON (%s) — keeping previous version",
                    filename, exc,
                )
                return cached[1]
            raise ConfigurationError(
                f"config/{filename} is not valid JSON — fix the file syntax."
            ) from exc
        _file_cache[filename] = (mtime, data)
        logger.info("Loaded config/%s (mtime %s)", filename, mtime)
        return data


def _stored(name: str) -> Any | None:
    """The admin-saved document, or None when the seed file applies.
    A store outage never breaks extraction: the last known copy (or the
    file) is used."""
    from app.services import config_store

    now = time.monotonic()
    with _lock:
        cached = _store_cache.get(name)
        if cached and now - cached[2] < _RECHECK_SECONDS:
            return cached[1]
    try:
        version = config_store.version(name)
        if cached and cached[0] == version:
            data = cached[1]
        else:
            data = config_store.get(name)[0] if version else None
    except Exception as exc:  # noqa: BLE001 — degrade to the last known copy
        logger.warning("Config store unavailable for %s: %s", name, exc)
        return cached[1] if cached else None
    with _lock:
        _store_cache[name] = (version, data, now)
    return data


def invalidate() -> None:
    """Forget the cached store versions (called after a save, and by tests)."""
    with _lock:
        _store_cache.clear()


# ── Insurers ───────────────────────────────────────────────────────────────

def insurers_document() -> dict:
    """Canonical insurers document: {"insurers": [{id, name, legal_names,
    debt_collection, active}]}, from the store or the seed file."""
    from app.services.config_store import normalise_insurers

    stored = _stored("insurers")
    if stored is not None:
        return stored
    return normalise_insurers(_load_json("insurers.json"))


def get_insurers() -> list[dict]:
    """The standing insurer list, active and inactive (names of insurers
    on old projects must still resolve): [{id, name, legal_names,
    debt_collection, active}, ...]."""
    return insurers_document()["insurers"]


def active_insurers() -> list[dict]:
    """What the setup screen offers (BRD S3)."""
    return [i for i in get_insurers() if i.get("active", True)]


def _alias_map() -> dict[str, str]:
    """lowercased canonical/legal name -> insurer id."""
    out: dict[str, str] = {}
    for ins in get_insurers():
        out[ins["name"].lower()] = ins["id"]
        for name in ins.get("legal_names", []):
            out[name.lower()] = ins["id"]
    return out


def match_insurer(extracted_name: str | None) -> dict | None:
    """
    Match an extracted insurer name against the standing list, using the
    canonical and legal names (case-insensitive substring both ways).
    """
    if not extracted_name:
        return None
    needle = extracted_name.lower().strip()
    aliases = _alias_map()
    hit_id = aliases.get(needle)
    if hit_id is None:
        for alias, ins_id in aliases.items():
            if alias in needle or needle in alias:
                hit_id = ins_id
                break
    if hit_id is None:
        return None
    return next((i for i in get_insurers() if i["id"] == hit_id), None)


DEBT_BASE_OPTIONS = ("Included", "Outsourced")


def debt_collection_rule(extracted_name: str | None) -> tuple[str, str | None]:
    """
    BRD 2.4: the insurers flagged `included` in config (Allianz, Atradius,
    Coface, Cartan) default to Included; every other insurer (and an
    unrecognised one) defaults to Outsourced. An insurer may carry its own
    wording for the value (`debt_collection_label`, e.g. Cartan's
    "Inclusive collections"). Returns (value, matched standing-list name
    or None). Editable per column in the UI — this only sets the default.
    """
    matched = match_insurer(extracted_name)
    if matched is None:
        return "Outsourced", None
    label = matched.get("debt_collection_label")
    if label:
        return label, matched["name"]
    value = "Included" if matched["debt_collection"] == "included" else "Outsourced"
    return value, matched["name"]


def debt_collection_options() -> list[str]:
    """Every wording the Debt collection set field may hold: the two rule
    values plus each configured per-insurer label (B1)."""
    labels = [i["debt_collection_label"] for i in get_insurers() if i.get("debt_collection_label")]
    out = list(DEBT_BASE_OPTIONS)
    for label in labels:
        if label not in out:
            out.append(label)
    return out


# ── Terminology ────────────────────────────────────────────────────────────

def terminology_document() -> dict:
    """Canonical terminology document: {"fields": {std field: [terms]},
    "insurers": {insurer id: {std field: [terms]}}}."""
    from app.services.config_store import normalise_terminology

    stored = _stored("terminology")
    if stored is not None:
        return stored
    ids = {i["id"] for i in get_insurers()}
    return normalise_terminology(_load_json("terminology.json"), ids)


def wording_rules() -> dict:
    """Normalisation rules from the mapping library (B3):
    {insurer id | '*': {field: [{match, render}]}}."""
    return terminology_document().get("rules") or {}


# ── Presentation wording ───────────────────────────────────────────────────

_WORDING_KEYS = ("brand", "about", "feedback_intro", "fair_presentation", "terms_notes",
                 "important_information", "demands", "recommendation", "reasons_intro", "our_status",
                 "contact", "contact_lines")


def presentation_wording() -> dict:
    """The fixed presentation text (BRD 2.7 / 2.8) from
    config/presentation.json — configuration, re-read on change."""
    doc = _load_json("presentation.json")
    missing = [k for k in _WORDING_KEYS if k not in doc]
    if missing:
        raise ConfigurationError(
            f"config/presentation.json is missing {missing} — restore them from the repository."
        )
    if "{name}" not in doc["recommendation"]:
        raise ConfigurationError("config/presentation.json: 'recommendation' must contain {name}.")
    return doc


def get_terminology() -> dict[str, list[str]]:
    """field name -> every insurer wording that maps onto that row (global
    terms plus the per-insurer ones) — what the extraction prompt uses."""
    from app.services.config_store import merged_terminology

    return merged_terminology(terminology_document())
