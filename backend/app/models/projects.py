"""
API schemas for project management (`/projects`).

A project resource exposes the searchable facts as fields, the ordered
"insurers approached" list as a relation, and the broker's working
document under `state`. Writes come in three shapes: create (POST),
replace/upsert (PUT) and partial update (PATCH).
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

ProjectType = Literal["new", "renewal"]
ProjectStatus = Literal["draft", "ready", "sent", "closed"]
SortKey = Literal[
    "updated_desc", "updated_asc", "client_asc", "client_desc", "created_desc", "created_asc",
]

_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
_MAX_STATE_BYTES = 2 * 1024 * 1024


def _clean(value: str) -> str:
    return " ".join(value.split())


class InsurerRef(BaseModel):
    """One approached insurer: the id from GET /insurers, its display
    name at read time, and its position in the tick order."""
    id: str
    name: str
    position: int


class _ProjectFields(BaseModel):
    client_name: str = Field(default="", max_length=200)
    reference: str = Field(default="", max_length=100)
    project_type: ProjectType | None = None
    policy_type: str | None = Field(default=None, max_length=100)
    status: ProjectStatus = "draft"
    insurers_approached: list[str] = Field(default_factory=list, max_length=50)
    generated_at: datetime | None = None
    state: dict = Field(default_factory=dict)

    @field_validator("client_name", "reference")
    @classmethod
    def _tidy(cls, value: str) -> str:
        return _clean(value)

    @field_validator("policy_type")
    @classmethod
    def _tidy_optional(cls, value: str | None) -> str | None:
        return _clean(value) if value is not None else None

    @field_validator("insurers_approached")
    @classmethod
    def _tidy_ids(cls, value: list[str]) -> list[str]:
        return [v.strip() for v in value if v and v.strip()]


class ProjectCreate(_ProjectFields):
    """POST /projects — `id` is optional; the server mints one otherwise."""
    id: str | None = Field(default=None, pattern=_ID_PATTERN)


class ProjectReplace(_ProjectFields):
    """PUT /projects/{id} — the full resource (missing fields take defaults)."""


class ProjectPatch(BaseModel):
    """PATCH /projects/{id} — only the fields present are changed."""
    client_name: str | None = Field(default=None, max_length=200)
    reference: str | None = Field(default=None, max_length=100)
    project_type: ProjectType | None = None
    policy_type: str | None = Field(default=None, max_length=100)
    status: ProjectStatus | None = None
    insurers_approached: list[str] | None = Field(default=None, max_length=50)
    generated_at: datetime | None = None
    state: dict | None = None

    @field_validator("client_name", "reference", "policy_type")
    @classmethod
    def _tidy(cls, value: str | None) -> str | None:
        return _clean(value) if value is not None else None

    @field_validator("insurers_approached")
    @classmethod
    def _tidy_ids(cls, value: list[str] | None) -> list[str] | None:
        return [v.strip() for v in value if v and v.strip()] if value is not None else None


class InsurersReplace(BaseModel):
    """PUT /projects/{id}/insurers — the whole ordered list."""
    insurers: list[str] = Field(max_length=50)

    @field_validator("insurers")
    @classmethod
    def _tidy_ids(cls, value: list[str]) -> list[str]:
        return [v.strip() for v in value if v and v.strip()]


class ProjectOut(BaseModel):
    id: str
    client_name: str
    reference: str
    project_type: ProjectType | None
    policy_type: str | None
    status: ProjectStatus
    insurers_approached: list[InsurerRef]
    owner_email: str
    updated_by: str
    created_at: datetime
    updated_at: datetime
    generated_at: datetime | None
    state: dict


class ProjectPage(BaseModel):
    items: list[ProjectOut]
    total: int
    limit: int
    offset: int


class ProjectInsurersOut(BaseModel):
    project_id: str
    insurers: list[InsurerRef]
