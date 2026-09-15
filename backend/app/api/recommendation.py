"""Recommendation endpoints (BRD 2.7, S7): read and set the recommended
insurer with the broker's reasons and key differences."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import audit
from app.core.auth import require_user
from app.db.engine import get_session
from app.services import projects as repo
from app.services import recommendation as rec

router = APIRouter(dependencies=[Depends(require_user)], prefix="/projects/{project_id}/recommendation")

User = Annotated[dict, Depends(require_user)]
Db = Annotated[Session, Depends(get_session)]


class CandidateOut(BaseModel):
    column_id: str
    name: str
    insurer_id: str | None


class RecommendationOut(BaseModel):
    insurer: str | None
    insurer_id: str | None
    column_id: str | None
    reasons: str
    key_differences: str
    candidates: list[CandidateOut]
    declined: list[str]


class RecommendationIn(BaseModel):
    """`insurer` is the canonical standing-list name (null clears)."""
    insurer: str | None = Field(default=None, max_length=200)
    reasons: str = Field(default="", max_length=4000)
    key_differences: str = Field(default="", max_length=4000)


def _project(session: Session, project_id: str):
    project = repo.get(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _approached(project) -> list[str]:
    return [link.insurer_id for link in project.insurers]


@router.get("", response_model=RecommendationOut)
def get_recommendation(project_id: str, session: Db) -> dict:
    project = _project(session, project_id)
    return rec.current(project.state or {}, _approached(project))


@router.put("", response_model=RecommendationOut)
def put_recommendation(project_id: str, body: RecommendationIn, session: Db, user: User) -> dict:
    """Choose the recommended insurer (it must have a quote in this project;
    an insurer that declined is refused with 422) and store the reasons and
    key differences. The system never ranks or suggests (BRD 2.7)."""
    project = _project(session, project_id)
    approached = _approached(project)
    with repo.project_lock(project_id):
        repo.require(session, project_id, for_update=True)
        try:
            next_state = rec.set_recommendation(project.state or {}, approached, body.insurer,
                                                body.reasons, body.key_differences)
        except rec.UnknownInsurer as exc:
            raise HTTPException(status_code=422, detail=f"Unknown insurer: {exc}. Use a standing-list name.") from exc
        except rec.NoQuote as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        repo.patch(session, project.id, {"state": next_state}, user["email"])
        session.commit()
    session.refresh(project)
    view = rec.current(project.state or {}, approached)
    audit.record("recommendation.set", target=project.id, actor=user["email"],
                 insurer=view["insurer"], cleared=view["column_id"] is None)
    return view
