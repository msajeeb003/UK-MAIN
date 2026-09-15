"""
Credit-limits endpoints (BRD 2.6, S6): the buyer × insurer table with
CRUD on rows and per-insurer limits, and its download as an editable
Excel workbook or an editable (form-field) PDF. Rules and builders live
in app/services/limits.py; writes persist through the project repository
so the table stays part of the one working document.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import audit
from app.core.auth import require_user
from app.db.engine import get_session
from app.services import limits
from app.services import projects as repo

router = APIRouter(dependencies=[Depends(require_user)], prefix="/projects/{project_id}/limits")

User = Annotated[dict, Depends(require_user)]
Db = Annotated[Session, Depends(get_session)]

Provenance = Literal["extracted", "edited", "manual", "blank"]


class LimitCellOut(BaseModel):
    value: str
    provenance: Provenance
    amount: int | None
    declined: bool


class LimitRowOut(BaseModel):
    id: str
    manual: bool
    buyer: LimitCellOut
    company_number: LimitCellOut
    required: LimitCellOut
    offers: dict[str, LimitCellOut]
    pending: dict[str, str]


class LimitColumnOut(BaseModel):
    id: str
    name: str
    matched: str | None = None


class HiddenColumnOut(BaseModel):
    id: str
    name: str


class TotalsOut(BaseModel):
    required: int | None
    offers: dict[str, int | None]


class LimitsGridOut(BaseModel):
    project_id: str
    columns: list[LimitColumnOut]
    hidden_columns: list[HiddenColumnOut]
    rows: list[LimitRowOut]
    totals: TotalsOut
    has_data: bool


class RowCreate(BaseModel):
    buyer: str = Field(default="", max_length=200)
    company_number: str = Field(default="", max_length=40)
    required: str = Field(default="", max_length=80)
    offers: dict[str, str] = Field(default_factory=dict, max_length=20)


class RowPatch(BaseModel):
    buyer: str | None = Field(default=None, max_length=200)
    company_number: str | None = Field(default=None, max_length=40)
    required: str | None = Field(default=None, max_length=80)


class OfferUpdate(BaseModel):
    value: str = Field(max_length=80)


class ColumnVisibility(BaseModel):
    hidden: bool


def _project(session: Session, project_id: str):
    project = repo.get(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _view(project) -> dict:
    return limits.grid_view(project.id, project.state or {})


def _apply(session: Session, project, actor: str, fn, *, action: str, **detail):
    """Run a mutation; persist and audit only when something changed."""
    with limits_lock(project.id):
        repo.require(session, project.id, for_update=True)   # latest state, row locked
        return _apply_locked(session, project, actor, fn, action=action, **detail)


def limits_lock(project_id: str):
    return repo.project_lock(project_id)


def _apply_locked(session: Session, project, actor: str, fn, *, action: str, **detail):
    try:
        result = fn(project.state or {})
    except limits.RowNotFound as exc:
        raise HTTPException(status_code=404, detail="Buyer row not found.") from exc
    except limits.ColumnNotFound as exc:
        raise HTTPException(status_code=404, detail="Insurer column not found in the credit-limit table.") from exc
    next_state = result[0] if isinstance(result, tuple) else result
    if next_state is None:
        return result
    repo.patch(session, project.id, {"state": next_state}, actor)
    session.commit()
    session.refresh(project)
    audit.record(action, target=project.id, actor=actor, **detail)     # metadata only, no amounts
    return result


# ── Grid ───────────────────────────────────────────────────────────────────

@router.get("", response_model=LimitsGridOut)
def get_limits(project_id: str, session: Db) -> dict:
    """Buyer rows, the insurer columns with a quote, per-cell provenance,
    and the totals."""
    return _view(_project(session, project_id))


# ── Rows ───────────────────────────────────────────────────────────────────

@router.post("/rows", response_model=LimitsGridOut, status_code=status.HTTP_201_CREATED)
def add_row(project_id: str, body: RowCreate, session: Db, user: User, response: Response) -> dict:
    """Add a buyer (a facility agreed offline). Amounts are normalised to
    full pounds; "0" / nil is a declined limit."""
    project = _project(session, project_id)
    _, row_id = _apply(session, project, user["email"],
                       lambda s: limits.add_row(s, body.buyer, body.company_number, body.required, body.offers),
                       action="limits.row.add")
    response.headers["Location"] = f"/projects/{project_id}/limits/rows/{row_id}"
    return _view(project)


@router.patch("/rows/{row_id}", response_model=LimitsGridOut)
def update_row(project_id: str, row_id: str, body: RowPatch, session: Db, user: User) -> dict:
    """Change the buyer name, company number and/or required limit."""
    project = _project(session, project_id)
    fields = body.model_dump(exclude_unset=True)
    _apply(session, project, user["email"], lambda s: limits.update_row(s, row_id, fields),
           action="limits.row.edit", row_id=row_id, fields=sorted(fields))
    return _view(project)


@router.delete("/rows/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_row(project_id: str, row_id: str, session: Db, user: User) -> Response:
    project = _project(session, project_id)
    _apply(session, project, user["email"], lambda s: limits.delete_row(s, row_id),
           action="limits.row.delete", row_id=row_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Per-insurer limits ─────────────────────────────────────────────────────

@router.put("/rows/{row_id}/offers/{column_id}", response_model=LimitsGridOut)
def set_offer(project_id: str, row_id: str, column_id: str, body: OfferUpdate,
              session: Db, user: User) -> dict:
    """The limit one insurer offers this buyer; an empty value clears it."""
    project = _project(session, project_id)
    _apply(session, project, user["email"], lambda s: limits.set_offer(s, row_id, column_id, body.value),
           action="limits.offer", row_id=row_id, column_id=column_id, cleared=not body.value.strip())
    return _view(project)


@router.delete("/rows/{row_id}/offers/{column_id}", response_model=LimitsGridOut)
def clear_offer(project_id: str, row_id: str, column_id: str, session: Db, user: User) -> dict:
    project = _project(session, project_id)
    _apply(session, project, user["email"], lambda s: limits.set_offer(s, row_id, column_id, ""),
           action="limits.offer", row_id=row_id, column_id=column_id, cleared=True)
    return _view(project)


@router.put("/columns/{column_id}", response_model=LimitsGridOut)
def set_column_visibility(project_id: str, column_id: str, body: ColumnVisibility,
                          session: Db, user: User) -> dict:
    """Hide an insurer from the credit-limit table (drops its offers) or
    bring it back. The comparison column itself is untouched."""
    project = _project(session, project_id)
    _apply(session, project, user["email"], lambda s: limits.set_column_hidden(s, column_id, body.hidden),
           action="limits.column", column_id=column_id, hidden=body.hidden)
    return _view(project)


# ── Downloads ──────────────────────────────────────────────────────────────

_MEDIA = {
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", limits.build_xlsx),
    "pdf": ("application/pdf", limits.build_pdf),
}


@router.get("/export/{format}")
def export_limits(project_id: str, format: Literal["xlsx", "pdf"], session: Db, user: User) -> Response:
    """The table as an editable Excel workbook (totals as formulas) or an
    editable PDF (value cells are form fields). Built from the current
    table on every request — nothing to generate first."""
    project = _project(session, project_id)
    media, build = _MEDIA[format]
    try:
        content = build(_view(project), project.client_name)
    except limits.NoLimitData as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    audit.record("limits.export", target=project.id, actor=user["email"], format=format)
    filename = limits.export_filename(project.client_name, format)
    return Response(content=content, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"',
                             "Cache-Control": "private, no-store"})
