"""
Project repository: CRUD, search and the insurers-approached relation over
the SQLAlchemy models (app/db/models.py). Pure data access — no HTTP —
so the API layer, the retention purge and the CLI share one code path.
"""

from __future__ import annotations

import json
import logging
import secrets
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import PROJECT_STATUSES, PROJECT_TYPES, Project, ProjectInsurer, utcnow
from app.services.library import get_insurers

logger = logging.getLogger(__name__)

MAX_STATE_BYTES = 2 * 1024 * 1024


class ProjectNotFound(LookupError):
    pass


class ProjectExists(ValueError):
    pass


class UnknownInsurers(ValueError):
    def __init__(self, ids: list[str]) -> None:
        super().__init__(f"Unknown insurer id(s): {', '.join(ids)}")
        self.ids = ids


class StateTooLarge(ValueError):
    pass


# ── Insurers (standing list from config/insurers.json) ─────────────────────

def insurer_names() -> dict[str, str]:
    return {i["id"]: i["name"] for i in get_insurers()}


def normalise_insurers(ids: Iterable[str]) -> list[str]:
    """Trim, de-duplicate (first occurrence wins, order kept) and validate
    against the standing list. Raises UnknownInsurers listing the bad ids."""
    known = insurer_names()
    seen: list[str] = []
    unknown: list[str] = []
    for raw in ids:
        i = (raw or "").strip()
        if not i or i in seen:
            continue
        (seen if i in known else unknown).append(i)
    if unknown:
        raise UnknownInsurers(unknown)
    return seen


def set_insurers(project: Project, ids: list[str]) -> None:
    """Replace the approached list with `ids` (already normalised), keeping
    the given order as `position`."""
    project.insurers = [
        ProjectInsurer(insurer_id=insurer_id, position=pos) for pos, insurer_id in enumerate(ids)
    ]


# ── Helpers ────────────────────────────────────────────────────────────────

def _check_state(state: dict) -> None:
    if len(json.dumps(state, separators=(",", ":"))) > MAX_STATE_BYTES:
        raise StateTooLarge("Project state too large.")


def _aware(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; everything stored is UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def new_id() -> str:
    return secrets.token_hex(8)


def _apply(project: Project, data: dict, actor: str) -> None:
    """Write the provided keys of `data` (already validated by the API
    schema) onto the row. `insurers_approached` is normalised here so a
    bad id fails the whole write before anything is flushed."""
    for key in ("client_name", "reference", "project_type", "policy_type", "status", "generated_at"):
        if key in data:
            setattr(project, key, data[key])
    if "state" in data:
        _check_state(data["state"])
        project.state = data["state"]
    if "insurers_approached" in data:
        set_insurers(project, normalise_insurers(data["insurers_approached"]))
    project.updated_by = actor
    project.updated_at = utcnow()


def serialize(project: Project) -> dict:
    names = insurer_names()
    return {
        "id": project.id,
        "client_name": project.client_name,
        "reference": project.reference,
        "project_type": project.project_type,
        "policy_type": project.policy_type,
        "status": project.status,
        "insurers_approached": [
            {"id": link.insurer_id, "name": names.get(link.insurer_id, link.insurer_id),
             "position": link.position}
            for link in project.insurers
        ],
        "owner_email": project.owner_email,
        "updated_by": project.updated_by,
        "created_at": _aware(project.created_at),
        "updated_at": _aware(project.updated_at),
        "generated_at": _aware(project.generated_at),
        "state": project.state or {},
    }


# ── CRUD ───────────────────────────────────────────────────────────────────

def get(session: Session, project_id: str) -> Project | None:
    return session.get(Project, project_id)


def require(session: Session, project_id: str) -> Project:
    project = get(session, project_id)
    if project is None:
        raise ProjectNotFound(project_id)
    return project


def create(session: Session, data: dict, actor: str, project_id: str | None = None) -> Project:
    project_id = project_id or new_id()
    if get(session, project_id) is not None:
        raise ProjectExists(project_id)
    project = Project(id=project_id, owner_email=actor, created_at=utcnow())
    _apply(project, data, actor)
    session.add(project)
    session.flush()
    return project


def ensure(session: Session, project_id: str, actor: str) -> Project:
    """The row a legacy upload path refers to — created as an empty draft
    when absent (the classic SPA saves the project in a separate request)."""
    project = get(session, project_id)
    if project is None:
        project = create(session, {}, actor, project_id=project_id)
    return project


def upsert(session: Session, project_id: str, data: dict, actor: str) -> tuple[Project, bool]:
    """PUT semantics: create the resource at this id, or replace it whole.
    Returns (project, created)."""
    project = get(session, project_id)
    if project is None:
        return create(session, data, actor, project_id=project_id), True
    _apply(project, data, actor)
    session.flush()
    return project, False


def patch(session: Session, project_id: str, data: dict, actor: str) -> Project:
    """Partial update — `data` holds only the keys the caller sent."""
    project = require(session, project_id)
    _apply(project, data, actor)
    session.flush()
    return project


def delete(session: Session, project_id: str) -> bool:
    project = get(session, project_id)
    if project is None:
        return False
    session.delete(project)          # project_insurers rows cascade
    session.flush()
    return True


# ── Search ─────────────────────────────────────────────────────────────────

_SORTS = {
    "updated_desc": (Project.updated_at.desc(), Project.id.asc()),
    "updated_asc": (Project.updated_at.asc(), Project.id.asc()),
    "client_asc": (func.lower(Project.client_name).asc(), Project.updated_at.desc()),
    "client_desc": (func.lower(Project.client_name).desc(), Project.updated_at.desc()),
    "created_desc": (Project.created_at.desc(), Project.id.asc()),
    "created_asc": (Project.created_at.asc(), Project.id.asc()),
}


def _like(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search(
    session: Session,
    *,
    q: str = "",
    status: Iterable[str] | None = None,
    project_type: str | None = None,
    insurer: str | None = None,
    sort: str = "updated_desc",
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Project], int]:
    """Filtered, sorted, paged listing. `q` matches the client name or
    reference (case-insensitive substring); `insurer` keeps projects that
    approached that insurer id."""
    stmt = select(Project)
    if q and q.strip():
        pattern = _like(q.strip())
        stmt = stmt.where(or_(
            Project.client_name.ilike(pattern, escape="\\"),
            Project.reference.ilike(pattern, escape="\\"),
        ))
    statuses = [s for s in (status or []) if s in PROJECT_STATUSES]
    if statuses:
        stmt = stmt.where(Project.status.in_(statuses))
    if project_type in PROJECT_TYPES:
        stmt = stmt.where(Project.project_type == project_type)
    if insurer:
        stmt = stmt.where(exists().where(
            ProjectInsurer.project_id == Project.id, ProjectInsurer.insurer_id == insurer,
        ))
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = _SORTS.get(sort, _SORTS["updated_desc"])
    rows = session.scalars(stmt.order_by(*order).limit(limit).offset(offset)).all()
    return list(rows), int(total)


def expired_ids(session: Session, cutoff: datetime) -> list[str]:
    """Projects untouched since `cutoff` (retention purge, BRD 2.11)."""
    stmt = select(Project.id).where(Project.updated_at < cutoff).order_by(Project.updated_at)
    return list(session.scalars(stmt).all())


# ── Legacy import (SQLite blob table from app/core/db.py) ─────────────────

def _ms_to_dt(value) -> datetime | None:
    if isinstance(value, int | float) and value > 0:
        # Epoch ms (the web app) or epoch s (older rows) — pick by magnitude.
        seconds = value / 1000 if value > 1e11 else value
        try:
            return datetime.fromtimestamp(seconds, tz=UTC)
        except (OverflowError, OSError, ValueError):
            return None
    return None


def import_legacy(session: Session) -> int:
    """Copy rows from the legacy `projects` blob table that are not yet in
    the relational store. The blob's top-level facts become columns; ids
    of insurers no longer in the standing list are dropped (logged)."""
    from app.core import db as legacy

    try:
        rows = legacy.query("SELECT id, updated, state FROM projects")
    except Exception:  # noqa: BLE001 — legacy table absent or unreadable
        return 0
    known = insurer_names()
    count = 0
    for row in rows:
        if get(session, row["id"]) is not None:
            continue
        try:
            state = json.loads(row["state"]) or {}
        except (TypeError, ValueError):
            state = {}
        if not isinstance(state, dict):
            state = {}
        approached = [i for i in (state.get("approached") or []) if isinstance(i, str)]
        unknown = [i for i in approached if i not in known]
        if unknown:
            logger.warning("Legacy project %s: dropping unknown insurer ids %s", row["id"], unknown)
        project_type = state.get("projectType")
        status = state.get("status")
        updated = _ms_to_dt(row["updated"]) or utcnow()
        project = Project(
            id=row["id"],
            client_name=str(state.get("clientName") or "")[:200],
            reference=str(state.get("ref") or "")[:100],
            project_type=project_type if project_type in PROJECT_TYPES else None,
            policy_type=(str(state.get("policyType"))[:100] if state.get("policyType") else None),
            status=status if status in PROJECT_STATUSES else "draft",
            owner_email="",
            updated_by="",
            state=state,
            created_at=_ms_to_dt(state.get("created")) or updated,
            updated_at=_ms_to_dt(state.get("updated")) or updated,
            generated_at=_ms_to_dt(state.get("generatedAt")),
        )
        set_insurers(project, [i for i in dict.fromkeys(approached) if i in known])
        session.add(project)
        count += 1
    session.flush()
    return count
