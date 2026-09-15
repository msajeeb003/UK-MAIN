"""
Background extraction jobs (BRD S4: per-document processing status).

`POST /extract-jobs` accepts the same upload as `/extract-quote` but
returns at once with a job id; the pipeline runs on a worker thread and
the browser polls `GET /extract-jobs/{id}` for queued → processing → done
or error. Job state lives in SQLite so a poll can land on any gunicorn
worker; the file bytes stay in memory of the process that accepted them
(the thread that processes the job runs there too).

A bounded number of extractions run concurrently per process; the rest
wait in the queue. Finished jobs are kept for a day so a reloaded tab can
still pick up its results, then swept.
"""

import asyncio
import json
import logging
import secrets
import threading
import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.api.routes import process_upload, validate_upload
from app.core import db
from app.core.auth import require_user
from app.services import documents as docs
from app.services.pipeline import EngineOverride, FileKind, StepRecorder

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_user)])

JobStatus = Literal["queued", "processing", "done", "error"]

MAX_CONCURRENT = 3                 # simultaneous extractions per process
RETENTION_SECONDS = 24 * 3600      # finished jobs are readable for a day
RETRY_DELAY_SECONDS = 2.0          # pause before the single retry of a transient failure
_slots = threading.Semaphore(MAX_CONCURRENT)


class JobView(BaseModel):
    job_id: str
    status: JobStatus
    stage: str
    filename: str
    kind: str
    project_id: str | None
    created: float
    updated: float
    result: dict | None = None
    error: str | None = None
    error_status: int | None = None


def _row_to_view(row) -> JobView:
    return JobView(
        job_id=row["id"], status=row["status"], stage=row["stage"],
        filename=row["filename"], kind=row["kind"],
        project_id=row["project_id"] or None,
        created=row["created"], updated=row["updated"],
        result=json.loads(row["result"]) if row["result"] else None,
        error=row["error"] or None,
        error_status=row["error_status"] or None,
    )


def _set(job_id: str, **fields) -> None:
    cols = ", ".join(f"{k}=?" for k in fields)
    db.execute(
        f"UPDATE extraction_jobs SET {cols}, updated=? WHERE id=?",  # noqa: S608 — keys are code constants
        (*fields.values(), db.now(), job_id),
    )


def _sweep_old_jobs() -> None:
    db.execute(
        "DELETE FROM extraction_jobs WHERE updated < ? AND status IN ('done','error')",
        (db.now() - RETENTION_SECONDS,),
    )


def _kind_label(doc_kind: str | None) -> str:
    return {"limits": "credit-limit doc", "expiring": "expiring policy"}.get(doc_kind or "", "quote")


def _fail(job_id: str, project_id: str | None, document_id: str | None, doc_kind: str | None,
          reason: str, status_code: int, rec: StepRecorder, attempt: int) -> None:
    """Terminal failure: the job row, the document record (`unreadable` with
    the reason) and its upload card — this document only."""
    _set(job_id, status="error", stage="failed", error=reason, error_status=status_code)
    if document_id:
        # The card first, the record last: once a poller sees the record
        # terminal, everything about this document is already in place.
        if project_id:
            docs.update_file_entry(project_id, document_id, status="error",
                                   meta=f"{_kind_label(doc_kind)} · {reason}", clear_job=True)
        docs.set_status(document_id, "unreadable", stage="failed", error=reason, attempt=attempt,
                        timings=[s.model_dump() for s in rec.steps])


def _run_job(job_id: str, file_bytes: bytes, filename: str, file_kind: FileKind,
             engine: EngineOverride, project_id: str | None, doc_kind: str | None,
             actor: str, document_id: str | None = None) -> None:
    """Worker-thread body: wait for a slot, run the shared upload pipeline,
    record the outcome. Never raises — every failure lands in the rows of
    this document only, so one bad file never blocks the others. A
    transient provider failure (rate limit, timeout) is retried once; a
    hard failure (unreadable file, no text after OCR, no insurer) marks the
    document `unreadable` with the reason."""
    with _slots:
        _set(job_id, status="processing", stage="extracting")
        if document_id:
            docs.set_status(document_id, "processing", stage="extracting", attempt=1)
            if project_id:
                docs.update_file_entry(project_id, document_id, status="processing",
                                       meta=f"{_kind_label(doc_kind)} · processing · reading and extracting")
        for attempt in (1, 2):
            rec = StepRecorder()
            try:
                result = asyncio.run(process_upload(
                    file_bytes, filename, file_kind, engine,
                    project_id=project_id, doc_kind=doc_kind, actor=actor,
                    endpoint="/extract-jobs", document_id=document_id, steps=rec,
                ))
                _set(job_id, status="done", stage="done", result=result.model_dump_json())
                return
            except HTTPException as exc:
                reason = str(exc.detail)
                if attempt == 1 and getattr(exc.__cause__, "transient", False):
                    logger.warning("Job %s: transient failure, retrying once: %s", job_id, reason)
                    _set(job_id, stage="retrying")
                    if document_id:
                        docs.set_status(document_id, "processing", stage="retrying", attempt=2,
                                        timings=[s.model_dump() for s in rec.steps])
                    time.sleep(RETRY_DELAY_SECONDS)
                    continue
                _fail(job_id, project_id, document_id, doc_kind, reason, exc.status_code, rec, attempt)
                return
            except Exception:  # noqa: BLE001 — must never kill the thread silently
                logger.exception("Extraction job %s crashed", job_id)
                _fail(job_id, project_id, document_id, doc_kind,
                      "Extraction failed unexpectedly. Check the server logs.", 502, rec, attempt)
                return


def create_job(*, project_id: str | None, doc_kind: str | None, filename: str,
               actor: str) -> str:
    """Record a queued job and return its id (nothing runs yet)."""
    job_id = secrets.token_hex(12)
    now = db.now()
    _sweep_old_jobs()
    db.execute(
        "INSERT INTO extraction_jobs (id, project_id, kind, filename, status, stage, "
        "actor, created, updated) VALUES (?,?,?,?,?,?,?,?,?)",
        (job_id, project_id or "", doc_kind or "quote", filename, "queued", "queued",
         actor, now, now),
    )
    return job_id


def start_job(job_id: str, file_bytes: bytes, filename: str, file_kind: FileKind,
              engine: EngineOverride, *, project_id: str | None, doc_kind: str | None,
              actor: str, document_id: str | None = None) -> None:
    """Run a recorded job on a worker thread."""
    threading.Thread(
        target=_run_job, name=f"extract-{job_id}", daemon=True,
        args=(job_id, file_bytes, filename, file_kind, engine, project_id,
              doc_kind, actor, document_id),
    ).start()


@router.post("/extract-jobs", response_model=JobView, status_code=202)
async def start_extraction_job(
    user: Annotated[dict, Depends(require_user)],
    file: Annotated[UploadFile, File(description="Insurer quote, credit-limit schedule or policy document")],
    project_id: Annotated[str | None, Form(max_length=64)] = None,
    doc_kind: Annotated[Literal["quote", "limits", "expiring"] | None, Form()] = None,
    engine: Annotated[EngineOverride, Query()] = "auto",
) -> JobView:
    """Validate the upload, queue it and return the job to poll."""
    filename, file_kind, file_bytes = await validate_upload(file)
    job_id = create_job(project_id=project_id, doc_kind=doc_kind, filename=filename,
                        actor=user["email"])
    start_job(job_id, file_bytes, filename, file_kind, engine, project_id=project_id,
              doc_kind=doc_kind, actor=user["email"])
    row = db.query_one("SELECT * FROM extraction_jobs WHERE id=?", (job_id,))
    return _row_to_view(row)


@router.get("/extract-jobs/{job_id}", response_model=JobView)
def get_extraction_job(job_id: str) -> JobView:
    row = db.query_one("SELECT * FROM extraction_jobs WHERE id=?", (job_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown or expired job.")
    return _row_to_view(row)
