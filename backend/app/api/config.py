"""
Admin configuration endpoints (BRD 2.3/2.4 "configuration, not code"):
the standing insurer list with its debt-collection rule, and the
terminology map. Role-gated (admin); every save is versioned and audited
and takes effect on the next pipeline run without a restart.
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core import audit
from app.core.auth import require_admin
from app.services import config_store, library

router = APIRouter(prefix="/config", dependencies=[Depends(require_admin)])

Admin = Annotated[dict, Depends(require_admin)]


class ConfigMeta(BaseModel):
    version: int
    updated_by: str | None
    updated_at: datetime | None
    source: Literal["database", "file"]


class InsurerIn(BaseModel):
    id: str = Field(max_length=40)
    name: str = Field(max_length=100)
    legal_names: list[str] = Field(default_factory=list, max_length=50)
    debt_collection: str = Field(max_length=20)
    active: bool = True


class InsurerOut(BaseModel):
    id: str
    name: str
    legal_names: list[str]
    debt_collection: Literal["included", "outsourced"]
    active: bool


class InsurersIn(BaseModel):
    insurers: list[InsurerIn] = Field(max_length=200)


class InsurersOut(ConfigMeta):
    insurers: list[InsurerOut]


class TerminologyIn(BaseModel):
    """`fields`: standard field → terms (any insurer). `insurers`: insurer
    id → {standard field → terms} for wording specific to one insurer."""
    fields: dict[str, list[str]] = Field(default_factory=dict)
    insurers: dict[str, dict[str, list[str]]] = Field(default_factory=dict)


class TerminologyOut(ConfigMeta):
    standard_fields: list[str]
    fields: dict[str, list[str]]
    insurers: dict[str, dict[str, list[str]]]


def _invalid(exc: config_store.ConfigInvalid) -> HTTPException:
    return HTTPException(status_code=422, detail={"message": "Configuration rejected.", "errors": exc.errors})


# ── Insurers ───────────────────────────────────────────────────────────────

@router.get("/insurers", response_model=InsurersOut)
def get_insurers_config() -> dict:
    _, meta = config_store.get(config_store.INSURERS)
    return {**meta, "insurers": library.get_insurers()}


@router.put("/insurers", response_model=InsurersOut)
def put_insurers_config(body: InsurersIn, admin: Admin) -> dict:
    """Replace the standing list: canonical name, legal names (the wording
    an insurer uses in its documents), debt-collection default, active
    flag. Names must be unique across the whole list."""
    try:
        data = config_store.normalise_insurers(body.model_dump())
    except config_store.ConfigInvalid as exc:
        raise _invalid(exc) from exc
    # The terminology map may name insurer ids; dropping one would orphan
    # its section, so refuse rather than silently lose wording.
    known = {i["id"] for i in data["insurers"]}
    orphaned = sorted(set(library.terminology_document().get("insurers", {})) - known)
    if orphaned:
        raise HTTPException(status_code=422, detail={
            "message": "Configuration rejected.",
            "errors": [f"Insurer '{i}' still has terminology; remove its terms first." for i in orphaned],
        })
    meta = config_store.save(config_store.INSURERS, data, admin["email"])
    audit.record("config.insurers", target=f"v{meta['version']}", actor=admin["email"],
                 count=len(data["insurers"]),
                 active=sum(1 for i in data["insurers"] if i["active"]))
    return {**meta, "insurers": data["insurers"]}


# ── Terminology ────────────────────────────────────────────────────────────

@router.get("/terminology", response_model=TerminologyOut)
def get_terminology_config() -> dict:
    _, meta = config_store.get(config_store.TERMINOLOGY)
    doc = library.terminology_document()
    return {**meta, "standard_fields": list(config_store.TERM_FIELDS), **doc}


@router.put("/terminology", response_model=TerminologyOut)
def put_terminology_config(body: TerminologyIn, admin: Admin) -> dict:
    """Replace the terminology map. Every field key must be one of the 16
    standard fields; insurer keys must be standing-list ids."""
    ids = {i["id"] for i in library.get_insurers()}
    try:
        data = config_store.normalise_terminology(body.model_dump(), ids)
    except config_store.ConfigInvalid as exc:
        raise _invalid(exc) from exc
    meta = config_store.save(config_store.TERMINOLOGY, data, admin["email"])
    audit.record("config.terminology", target=f"v{meta['version']}", actor=admin["email"],
                 terms=sum(len(v) for v in data["fields"].values())
                 + sum(len(t) for s in data["insurers"].values() for t in s.values()),
                 insurers=sorted(data["insurers"]))
    return {**meta, "standard_fields": list(config_store.TERM_FIELDS), **data}
