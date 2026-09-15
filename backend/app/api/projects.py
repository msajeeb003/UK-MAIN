"""Project management (BRD 2.9 / S2 / S3): RESTful CRUD + search over the
relational store (app/db, PostgreSQL), the ordered "insurers approached"
relation, right-to-erasure, and the retained documents / downloadable
exports that hang off a project.

The broker's working document travels as `state` — the server stores it
verbatim and never edits it. No versioning in this build.
"""

import re
import shutil
from typing import Annotated

import pymupdf
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core import audit, db
from app.core.auth import require_user
from app.core.config import get_settings
from app.db.engine import get_session
from app.models.projects import (
    InsurersReplace,
    ProjectCreate,
    ProjectInsurersOut,
    ProjectOut,
    ProjectPage,
    ProjectPatch,
    ProjectReplace,
    SortKey,
)
from app.services import projects as repo

router = APIRouter(dependencies=[Depends(require_user)])

_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
User = Annotated[dict, Depends(require_user)]
Db = Annotated[Session, Depends(get_session)]


def _audit_save(project, actor: str, created: bool) -> None:
    # Metadata-only audit: which key values are confirmed and the chosen
    # recommendation travel in the saved state — no document contents.
    state = project.state or {}
    confirmed = [k for k, v in (state.get("confirmed") or {}).items() if v]
    audit.record(
        "project.create" if created else "project.save",
        target=project.id, actor=actor,
        client_name=project.client_name,
        confirmed=confirmed, recommended=state.get("recommended"),
    )


def _write(session: Session, fn):
    """Run a repository write, translating its errors to HTTP statuses."""
    try:
        result = fn()
        session.commit()
        return result
    except repo.ProjectNotFound as exc:
        session.rollback()
        raise HTTPException(status_code=404, detail="Project not found.") from exc
    except repo.ProjectExists as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail="A project with this id already exists.") from exc
    except repo.UnknownInsurers as exc:
        session.rollback()
        raise HTTPException(
            status_code=422,
            detail={"message": "Unknown insurer id(s) — use ids from GET /insurers.",
                    "unknown": exc.ids},
        ) from exc
    except repo.StateTooLarge as exc:
        session.rollback()
        raise HTTPException(status_code=413, detail="Project state too large.") from exc


# ── Collection ─────────────────────────────────────────────────────────────

@router.get("/projects", response_model=ProjectPage)
def list_projects(
    session: Db,
    q: Annotated[str, Query(max_length=200, description="Client name or reference contains")] = "",
    status_filter: Annotated[list[str] | None, Query(alias="status")] = None,
    project_type: Annotated[str | None, Query(pattern="^(new|renewal)$")] = None,
    insurer: Annotated[str | None, Query(max_length=40, description="Approached insurer id")] = None,
    sort: SortKey = "updated_desc",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    """Search / list projects (S2). Every named user sees every project
    (BRD 2.10); filters narrow, they never scope by owner."""
    items, total = repo.search(
        session, q=q, status=status_filter, project_type=project_type, insurer=insurer,
        sort=sort, limit=limit, offset=offset,
    )
    return {"items": [repo.serialize(p) for p in items], "total": total,
            "limit": limit, "offset": offset}


@router.post("/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, session: Db, user: User) -> dict:
    data = body.model_dump(exclude={"id"})
    project = _write(session, lambda: repo.create(session, data, user["email"], project_id=body.id))
    _audit_save(project, user["email"], created=True)
    return repo.serialize(project)


# ── Item ───────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, session: Db) -> dict:
    project = repo.get(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return repo.serialize(project)


@router.put("/projects/{project_id}", response_model=ProjectOut)
def replace_project(project_id: str, body: ProjectReplace, session: Db, user: User,
                    response: Response) -> dict:
    """Replace the whole resource, or create it at this id (201)."""
    if not _ID_RE.fullmatch(project_id):
        raise HTTPException(status_code=422, detail="Invalid project id.")
    project, created = _write(
        session, lambda: repo.upsert(session, project_id, body.model_dump(), user["email"]))
    if created:
        response.status_code = status.HTTP_201_CREATED
    _audit_save(project, user["email"], created=created)
    return repo.serialize(project)


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, body: ProjectPatch, session: Db, user: User) -> dict:
    """Change only the fields present in the body."""
    data = body.model_dump(exclude_unset=True)
    project = _write(session, lambda: repo.patch(session, project_id, data, user["email"]))
    _audit_save(project, user["email"], created=False)
    return repo.serialize(project)


def delete_project_data(project_id: str) -> None:
    """Erase a project everywhere in live storage: the relational row (its
    insurer links cascade), the SQLite rows (documents, exports, metrics,
    legacy blob), then its files. Reused by the on-request delete and the
    scheduled retention purge. Idempotent — safe to call for an
    already-deleted project. Files go LAST (a filesystem delete cannot be
    rolled back, so the recoverable DB deletes commit first)."""
    from app.db.engine import session_scope

    with session_scope() as session:
        repo.delete(session, project_id)
    db.execute_transaction([
        ("DELETE FROM documents WHERE project_id=?", (project_id,)),
        ("DELETE FROM exports WHERE project_id=?", (project_id,)),
        ("DELETE FROM metrics WHERE project_id=?", (project_id,)),
        ("DELETE FROM projects WHERE id=?", (project_id,)),
    ])
    folder = get_settings().data_path / "projects" / project_id
    shutil.rmtree(folder, ignore_errors=True)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, session: Db, user: User) -> Response:
    """Right-to-erasure (BRD 2.11): an admin deletes a client/project on
    request, removing all DB rows and files. Note: point-in-time backups made
    before now still contain it until they age out of the backup retention
    window (see docs/DATA_RETENTION.md)."""
    existed = repo.get(session, project_id) is not None
    session.close()
    delete_project_data(project_id)
    if not existed:
        raise HTTPException(status_code=404, detail="Project not found.")
    # The audit entry deliberately survives the deletion (append-only).
    audit.record("project.delete", target=project_id, actor=user["email"])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Insurers approached (relation) ────────────────────────────────────────

def _insurers_out(project) -> dict:
    return {"project_id": project.id, "insurers": repo.serialize(project)["insurers_approached"]}


@router.get("/projects/{project_id}/insurers", response_model=ProjectInsurersOut)
def list_project_insurers(project_id: str, session: Db) -> dict:
    project = repo.get(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return _insurers_out(project)


@router.put("/projects/{project_id}/insurers", response_model=ProjectInsurersOut)
def replace_project_insurers(project_id: str, body: InsurersReplace, session: Db,
                             user: User) -> dict:
    """Replace the ordered list (S3: the insurers ticked at setup)."""
    project = _write(session, lambda: repo.patch(
        session, project_id, {"insurers_approached": body.insurers}, user["email"]))
    return _insurers_out(project)


@router.post("/projects/{project_id}/insurers/{insurer_id}", response_model=ProjectInsurersOut)
def add_project_insurer(project_id: str, insurer_id: str, session: Db, user: User) -> dict:
    """Append one insurer at the end of the list (no-op if already there)."""
    def run():
        project = repo.require(session, project_id)
        ids = [link.insurer_id for link in project.insurers] + [insurer_id]
        return repo.patch(session, project_id, {"insurers_approached": ids}, user["email"])
    return _insurers_out(_write(session, run))


@router.delete("/projects/{project_id}/insurers/{insurer_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def remove_project_insurer(project_id: str, insurer_id: str, session: Db, user: User) -> Response:
    def run():
        project = repo.require(session, project_id)
        ids = [link.insurer_id for link in project.insurers if link.insurer_id != insurer_id]
        return repo.patch(session, project_id, {"insurers_approached": ids}, user["email"])
    _write(session, run)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Exports and retained documents ────────────────────────────────────────

@router.get("/projects/{project_id}/exports/{format}")
def download_export(project_id: str, format: str) -> Response:
    """The latest generated file of this format (BRD S2 download links)."""
    row = db.query_one(
        "SELECT filename, stored_path FROM exports WHERE project_id=? AND format=?",
        (project_id, format),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No export generated yet.")
    try:
        # `with` guarantees the handle is closed even if read() raises —
        # on Windows an un-closed handle keeps the file locked, which would
        # then block the next export (regeneration overwrites this path).
        with open(row["stored_path"], "rb") as f:
            content = f.read()
    except OSError as exc:
        raise HTTPException(status_code=404, detail="Export file missing.") from exc
    media = {
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pdf": "application/pdf",
        "limits-xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }.get(format, "application/octet-stream")
    return Response(
        content=content, media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{row["filename"]}"'},
    )


@router.get("/projects/{project_id}/exports/pdf/page/{page}")
def export_pdf_page(project_id: str, page: int) -> Response:
    """One page of the latest generated PDF as an image (S8 preview). The
    preview is rendered from the same file the broker downloads, so it
    matches page for page. X-Page-Count lets the viewer paginate."""
    row = db.query_one(
        "SELECT stored_path FROM exports WHERE project_id=? AND format='pdf'",
        (project_id,),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No PDF generated yet.")
    try:
        doc = pymupdf.open(row["stored_path"])
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Export file missing.") from exc
    try:
        if not 1 <= page <= doc.page_count:
            raise HTTPException(status_code=404, detail="Page out of range.")
        png = doc[page - 1].get_pixmap(dpi=96).tobytes("png")
        page_count = doc.page_count
    finally:
        doc.close()
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "private, no-store",
                             "X-Page-Count": str(page_count)})


@router.get("/documents/{document_id}/page/{page}")
def document_page(document_id: str, page: int) -> Response:
    """One page of a retained PDF as an image — S5: clicking a value opens
    the source page. Excel documents have no page image (404)."""
    row = db.query_one(
        "SELECT stored_path FROM documents WHERE id=?", (document_id,)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        doc = pymupdf.open(row["stored_path"])
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Not a renderable PDF.") from exc
    try:
        if not 1 <= page <= doc.page_count:
            raise HTTPException(status_code=404, detail="Page out of range.")
        pix = doc[page - 1].get_pixmap(dpi=120)
        png = pix.tobytes("png")
        page_count = doc.page_count
    finally:
        doc.close()
    # X-Page-Count lets the viewer offer prev/next without a second request.
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600",
                             "X-Page-Count": str(page_count)})
