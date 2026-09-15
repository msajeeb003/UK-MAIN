"""
The broker's recommendation (BRD 2.7, S7): which insurer with a quote is
recommended, the reasons, and the key differences — stored in the
project's working document as the review screen does (`recommended` =
the comparison column id, `reasons`, `keyDifferences`). The API speaks in
canonical insurer names; this module resolves them to columns.
"""

from __future__ import annotations

import time

from app.services.library import get_insurers


class UnknownInsurer(ValueError):
    pass


class NoQuote(ValueError):
    """The insurer has no quote column in this project."""

    def __init__(self, name: str, declined: bool) -> None:
        super().__init__(
            f"{name} declined to quote on this project." if declined
            else f"{name} has no quote in this project."
        )
        self.declined = declined


def _lower(value) -> str:
    return str(value or "").strip().lower()


def _quote_columns(state: dict) -> list[dict]:
    cols = state.get("columns")
    if not isinstance(cols, list):
        return []
    return [c for c in cols if isinstance(c, dict) and c.get("id") and not c.get("expiring")]


def _insurer_for_column(col: dict, insurers: list[dict]) -> dict | None:
    """The standing-list insurer a quote column belongs to (by the matched
    name the upload recorded, else by the column's own name)."""
    for candidate in (col.get("matched"), col.get("name")):
        key = _lower(candidate)
        if not key:
            continue
        for ins in insurers:
            if key == _lower(ins["name"]) or key in {_lower(n) for n in ins.get("legal_names", [])}:
                return ins
    return None


def _find_insurer(name: str, insurers: list[dict]) -> dict:
    key = _lower(name)
    for ins in insurers:
        if key == _lower(ins["name"]) or key == _lower(ins["id"]):
            return ins
    for ins in insurers:
        if key in {_lower(n) for n in ins.get("legal_names", [])}:
            return ins
    raise UnknownInsurer(name)


def current(state: dict, approached: list[str]) -> dict:
    insurers = get_insurers()
    col_id = state.get("recommended") if isinstance(state.get("recommended"), str) else None
    col = next((c for c in _quote_columns(state) if c["id"] == col_id), None)
    ins = _insurer_for_column(col, insurers) if col else None
    return {
        "insurer": ins["name"] if ins else (str(col.get("name") or "") if col else None),
        "insurer_id": ins["id"] if ins else None,
        "column_id": col["id"] if col else None,
        "reasons": str(state.get("reasons") or ""),
        "key_differences": str(state.get("keyDifferences") or ""),
        "candidates": [
            {"column_id": c["id"], "name": str(c.get("name") or ""),
             "insurer_id": (_insurer_for_column(c, insurers) or {}).get("id")}
            for c in _quote_columns(state)
        ],
        "declined": [
            i["name"] for i in insurers
            if i["id"] in set(approached)
            and not any((_insurer_for_column(c, insurers) or {}).get("id") == i["id"]
                        for c in _quote_columns(state))
        ],
    }


def set_recommendation(state: dict, approached: list[str], insurer: str | None,
                       reasons: str, key_differences: str) -> dict:
    """Return the new state. `insurer` is a canonical name (or id / legal
    name); it must own a quote column here — a declined insurer (approached,
    no quote) or one not in the project is refused. None clears the choice
    but keeps the texts."""
    insurers = get_insurers()
    col_id: str | None = None
    if insurer is not None and insurer.strip():
        ins = _find_insurer(insurer, insurers)
        col = next((c for c in _quote_columns(state)
                    if (_insurer_for_column(c, insurers) or {}).get("id") == ins["id"]), None)
        if col is None:
            raise NoQuote(ins["name"], declined=ins["id"] in set(approached))
        col_id = col["id"]
    return {
        **state,
        "recommended": col_id,
        "reasons": " ".join(reasons.split("\r")).strip(),
        "keyDifferences": " ".join(key_differences.split("\r")).strip(),
        "updated": int(time.time() * 1000),
    }
