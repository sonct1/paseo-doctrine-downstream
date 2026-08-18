from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PROJECT_RE = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
PREFIX_RE = re.compile(r"^[a-z][a-z0-9]{0,11}$")
ISSUE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
LABEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$")


def validate_issue_id(value: str) -> str:
    if not ISSUE_ID_RE.fullmatch(value):
        raise ValueError("invalid issue id")
    return value


def validate_labels(values: list[str]) -> list[str]:
    if len(values) > 50:
        raise ValueError("at most 50 labels are allowed")
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not LABEL_RE.fullmatch(value):
            raise ValueError("invalid label")
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


class ProjectConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    prefix: str
    description: str = ""
    enabled: bool = True

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not PROJECT_RE.fullmatch(value):
            raise ValueError("project id must match ^[a-z][a-z0-9-]{0,62}$")
        return value

    @field_validator("prefix")
    @classmethod
    def validate_prefix(cls, value: str) -> str:
        if not PREFIX_RE.fullmatch(value):
            raise ValueError("prefix must match ^[a-z][a-z0-9]{0,11}$")
        return value


class ProjectEnsure(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prefix: str
    description: str = Field(default="", max_length=2_000)

    @field_validator("prefix")
    @classmethod
    def validate_prefix(cls, value: str) -> str:
        if not PREFIX_RE.fullmatch(value):
            raise ValueError("prefix must match ^[a-z][a-z0-9]{0,11}$")
        return value


IssueType = Literal["bug", "feature", "task", "epic", "chore", "decision"]
IssueStatus = Literal["open", "in_progress", "closed", "blocked", "deferred"]
DependencyType = Literal[
    "blocks",
    "tracks",
    "related",
    "parent-child",
    "discovered-from",
    "until",
    "caused-by",
    "validates",
    "relates-to",
    "supersedes",
]


class MutationGuard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["owned-mutation", "claim"]
    issue_id: str
    require_not_closed: Literal[True] = True

    @field_validator("issue_id")
    @classmethod
    def validate_guard_issue(cls, value: str) -> str:
        return validate_issue_id(value)


class IssueCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=100_000)
    acceptance: str = Field(default="", max_length=100_000)
    design: str = Field(default="", max_length=100_000)
    issue_type: IssueType = "task"
    priority: int = Field(default=2, ge=0, le=4)
    labels: list[str] = Field(default_factory=list)
    discovered_from: str | None = None
    guard: MutationGuard | None = None
    idempotency_key: str = Field(min_length=8, max_length=200)

    @field_validator("labels")
    @classmethod
    def validate_labels_field(cls, values: list[str]) -> list[str]:
        return validate_labels(values)

    @field_validator("discovered_from")
    @classmethod
    def validate_discovered(cls, value: str | None) -> str | None:
        return validate_issue_id(value) if value is not None else None


class IssueUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=100_000)
    acceptance: str | None = Field(default=None, max_length=100_000)
    design: str | None = Field(default=None, max_length=100_000)
    priority: int | None = Field(default=None, ge=0, le=4)
    status: IssueStatus | None = None
    assignee: str | None = Field(default=None, max_length=200)
    append_notes: str | None = Field(default=None, min_length=1, max_length=100_000)
    add_labels: list[str] = Field(default_factory=list)
    remove_labels: list[str] = Field(default_factory=list)
    guard: MutationGuard | None = None
    idempotency_key: str = Field(min_length=8, max_length=200)

    @field_validator("add_labels", "remove_labels")
    @classmethod
    def validate_labels_field(cls, values: list[str]) -> list[str]:
        return validate_labels(values)

    @model_validator(mode="after")
    def reject_label_conflict(self) -> "IssueUpdate":
        overlap = set(self.add_labels) & set(self.remove_labels)
        if overlap:
            raise ValueError(f"labels cannot be both added and removed: {sorted(overlap)}")
        return self


class ClaimRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    guard: MutationGuard | None = None
    idempotency_key: str = Field(min_length=8, max_length=200)


class CloseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(default="Completed", min_length=1, max_length=10_000)
    idempotency_key: str = Field(min_length=8, max_length=200)


class DependencyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    depends_on: str
    dependency_type: DependencyType = "blocks"
    guard: MutationGuard | None = None
    idempotency_key: str = Field(min_length=8, max_length=200)

    @field_validator("depends_on")
    @classmethod
    def validate_dep(cls, value: str) -> str:
        return validate_issue_id(value)


class IssueListQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    statuses: list[IssueStatus] = Field(default_factory=list, max_length=5)
    issue_type: IssueType | None = None
    priority: int | None = Field(default=None, ge=0, le=4)
    assignee: str | None = Field(default=None, min_length=1, max_length=200)
    labels: list[str] = Field(default_factory=list)
    limit: int = Field(default=50, ge=1, le=1_000)

    @field_validator("labels")
    @classmethod
    def validate_labels_field(cls, values: list[str]) -> list[str]:
        return validate_labels(values)


class ReadyQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    issue_type: IssueType | None = None
    priority: int | None = Field(default=None, ge=0, le=4)
    assignee: str | None = Field(default=None, min_length=1, max_length=200)
    labels: list[str] = Field(default_factory=list)
    limit: int = Field(default=100, ge=1, le=1_000)

    @field_validator("labels")
    @classmethod
    def validate_labels_field(cls, values: list[str]) -> list[str]:
        return validate_labels(values)
