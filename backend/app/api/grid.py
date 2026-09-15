"""
Comparison-grid endpoints (BRD 2.3–2.5, S5): read the 16-row grid, edit a
cell, revert an edit, override the two set fields per column, and manage
the four confirm-before-export flags. Rules live in app/services/grid.py;
every write goes through the project repository so the grid and the rest
of the working document stay one record.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import audit
from app.core.auth import require_user
from app.db.engine import get_session
from app.services import grid
from app.services import projects as repo

router = APIRouter(dependencies=[Depends(require_user)], prefix="/projects/{project_id}/grid")

User = Annotated[dict, Depends(require_user)]
Db = Annotated[Session, Depends(get_session)]

CellProvenance = Literal["header", "set", "extracted", "edited", "manual", "blank"]


class FieldOut(BaseModel):
    key: str
    label: str
    kind: Literal["header", "set", "extracted", "manual"]
    note: str | None = None
    set_source: Literal["project", "insurer_rule"] | None = None
    gated: str | None = None
    extra: bool = False


class CellOut(BaseModel):
    value: str
    orig: str | None
    page: int | None
    confidence: str | None
    provenance: CellProvenance
    source: Literal["override", "project", "insurer_rule"] | None
    edited: bool


class ColumnOut(BaseModel):
    id: str
    name: str
    matched: str | None
    expiring: bool
    manual: bool
    document_id: str | None
    pages: int | None
    cells: dict[str, CellOut]


class ConfirmationOut(BaseModel):
    confirmed: bool
    by: str | None
    at: int | None


class GateOut(BaseModel):
    required: int
    confirmed_count: int
    complete: bool
    missing: list[str]


class GridOut(BaseModel):
    project_id: str
    policy_type: str | None
    fields: list[FieldOut]
    standard_field_count: int
    columns: list[ColumnOut]
    confirmations: dict[str, ConfirmationOut]
    gate: GateOut
    reviewed: bool
    reviewed_at: float | None


class ConfirmationsOut(BaseModel):
    confirmations: dict[str, ConfirmationOut]
    gate: GateOut


class CellEdit(BaseModel):
    value: str = Field(max_length=4000)


class SetFieldOverride(BaseModel):
    value: str = Field(max_length=100)


class ConfirmationUpdate(BaseModel):
    confirmed: bool


class ConfirmationsUpdate(BaseModel):
    """Bulk form: field key → confirmed. Only gated fields are accepted."""
    confirmed: dict[str, bool] = Field(max_length=4)


def _project(session: Session, project_id: str):
    project = repo.get(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _view(project) -> dict:
    return grid.grid_view(project.id, project.policy_type, project.state or {})


def _apply(session: Session, project, actor: str, fn, *, action: str, **detail) -> bool:
    """Run a grid mutation; persist and audit only when something changed.
    Translates the rule errors to HTTP statuses."""
    with repo.project_lock(project.id):
        return _apply_locked(session, project, actor, fn, action=action, **detail)


def _apply_locked(session: Session, project, actor: str, fn, *, action: str, **detail) -> bool:
    repo.require(session, project.id, for_update=True)      # latest state, row locked
    try:
        next_state = fn(project.state or {})
    except grid.ColumnNotFound as exc:
        raise HTTPException(status_code=404, detail="Column not found.") from exc
    except grid.FieldNotFound as exc:
        raise HTTPException(
            status_code=404,
            detail={"message": "Unknown grid field.", "fields": list(grid.FIELD_BY_KEY)},
        ) from exc
    except grid.NotASetField as exc:
        raise HTTPException(status_code=422, detail="Only set fields (type, debt) can be overridden.") from exc
    except grid.NotGated as exc:
        raise HTTPException(
            status_code=422,
            detail={"message": "Only the four gated fields can be confirmed.",
                    "fields": list(grid.GATED_FIELDS)},
        ) from exc
    except grid.NothingToRevert as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except grid.InvalidValue as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if next_state is None:
        return False
    repo.patch(session, project.id, {"state": next_state}, actor)
    session.commit()
    session.refresh(project)
    # Metadata only: which cell / flag, never the quote values themselves.
    audit.record(action, target=project.id, actor=actor, **detail)
    return True


# ── Grid ───────────────────────────────────────────────────────────────────

@router.get("", response_model=GridOut)
def get_grid(project_id: str, session: Db) -> dict:
    """The full grid: row definitions, every column's cells with provenance,
    the confirmation flags and the export gate."""
    return _view(_project(session, project_id))


@router.patch("/columns/{column_id}/cells/{field_key}", response_model=GridOut)
def edit_cell(project_id: str, column_id: str, field_key: str, body: CellEdit,
              session: Db, user: User) -> dict:
    """The broker's edit of one cell. Extracted rows keep the AI's original
    (`orig`) for revert and the edit rate; a gated row loses its
    confirmation; the review tick is cleared."""
    project = _project(session, project_id)
    _apply(session, project, user["email"],
           lambda s: grid.edit_cell(s, project.policy_type, column_id, field_key, body.value),
           action="grid.edit", column_id=column_id, field=field_key)
    return _view(project)


@router.delete("/columns/{column_id}/cells/{field_key}", response_model=GridOut)
def revert_cell(project_id: str, column_id: str, field_key: str, session: Db, user: User) -> dict:
    """Undo the broker's edit: the AI's original value comes back."""
    project = _project(session, project_id)
    _apply(session, project, user["email"],
           lambda s: grid.revert_cell(s, column_id, field_key),
           action="grid.revert", column_id=column_id, field=field_key)
    return _view(project)


# ── Set-field overrides (BRD 2.4) ──────────────────────────────────────────

@router.put("/columns/{column_id}/set-fields/{field_key}", response_model=GridOut)
def override_set_field(project_id: str, column_id: str, field_key: str, body: SetFieldOverride,
                       session: Db, user: User) -> dict:
    """Override a set field for one column: `type` (one of the four policy
    types, else the project's) or `debt` (Included | Outsourced, else the
    insurer rule). An empty value clears the override."""
    project = _project(session, project_id)
    _apply(session, project, user["email"],
           lambda s: grid.set_override(s, column_id, field_key, body.value),
           action="grid.override", column_id=column_id, field=field_key,
           cleared=not body.value.strip())
    return _view(project)


@router.delete("/columns/{column_id}/set-fields/{field_key}", response_model=GridOut)
def clear_set_field(project_id: str, column_id: str, field_key: str, session: Db, user: User) -> dict:
    project = _project(session, project_id)
    _apply(session, project, user["email"],
           lambda s: grid.clear_override(s, column_id, field_key),
           action="grid.override", column_id=column_id, field=field_key, cleared=True)
    return _view(project)


# ── Confirmations (BRD 2.5 gate) ───────────────────────────────────────────

def _confirmations(project) -> dict:
    state = project.state or {}
    return {"confirmations": grid.confirmations(state), "gate": grid.gate(state)}


@router.get("/confirmations", response_model=ConfirmationsOut)
def get_confirmations(project_id: str, session: Db) -> dict:
    return _confirmations(_project(session, project_id))


@router.put("/confirmations/{field_key}", response_model=ConfirmationsOut)
def set_confirmation(project_id: str, field_key: str, body: ConfirmationUpdate,
                     session: Db, user: User) -> dict:
    """Confirm or unconfirm one gated field (annual premium, indemnity,
    excess, max liability). Who and when are recorded."""
    project = _project(session, project_id)
    _apply(session, project, user["email"],
           lambda s: grid.set_confirmation(s, field_key, body.confirmed, user["email"]),
           action="grid.confirm", field=field_key, confirmed=body.confirmed)
    return _confirmations(project)


@router.put("/confirmations", response_model=ConfirmationsOut)
def set_confirmations(project_id: str, body: ConfirmationsUpdate, session: Db, user: User) -> dict:
    """Bulk form of the above; all-or-nothing on validation."""
    project = _project(session, project_id)
    unknown = [k for k in body.confirmed if k not in grid.GATED_FIELDS]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail={"message": "Only the four gated fields can be confirmed.",
                    "unknown": unknown, "fields": list(grid.GATED_FIELDS)},
        )

    def run(state: dict) -> dict | None:
        changed = False
        current = state
        for key, on in body.confirmed.items():
            nxt = grid.set_confirmation(current, key, on, user["email"])
            if nxt is not None:
                current, changed = nxt, True
        return current if changed else None

    _apply(session, project, user["email"], run, action="grid.confirm",
           fields=sorted(body.confirmed))
    return _confirmations(project)


@router.get("/fields", response_model=list[FieldOut])
def list_fields() -> list[dict]:
    """The row definitions on their own (for clients that build the grid)."""
    return [dict(f) for f in grid.FIELDS]
