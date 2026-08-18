from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any, Awaitable, Callable

from .auth import Principal
from .beads import BeadsAdapter
from .control_store import ControlStore
from .models import (
    ClaimRequest,
    CloseRequest,
    DependencyCreate,
    IssueCreate,
    IssueListQuery,
    IssueUpdate,
    MutationGuard,
    ProjectConfig,
    ProjectEnsure,
    ReadyQuery,
    validate_issue_id,
)
from .projects import ProjectRegistry


class Forbidden(RuntimeError):
    pass


class GuardConflict(RuntimeError):
    pass


class CentralService:
    def __init__(self, registry: ProjectRegistry, adapter: BeadsAdapter, store: ControlStore):
        self.registry = registry
        self.adapter = adapter
        self.store = store
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._init_done: set[str] = set()

    def _authorize(self, principal: Principal, project: str, permission: str) -> None:
        # Check the token scope before resolving the project so scoped tokens do
        # not become an oracle for enumerating projects they cannot access.
        if not principal.can(project, permission):
            raise Forbidden(f"{principal.subject} lacks {permission} access to {project}")
        self.registry.get(project)

    @staticmethod
    def _audit_summary(result: Any) -> dict[str, Any]:
        # Audit operational facts, not full issue bodies/project memory. This keeps
        # the control DB small and avoids duplicating potentially sensitive prose.
        if isinstance(result, list):
            return {"kind": "list", "count": len(result)}
        if isinstance(result, dict):
            keep = ("id", "status", "issue_type", "child", "parent", "type")
            summary = {k: result[k] for k in keep if k in result}
            return {"kind": "object", **summary}
        if isinstance(result, str):
            return {"kind": "text", "length": len(result)}
        return {"kind": type(result).__name__}

    async def _ensure(self, project: str) -> None:
        if project in self._init_done:
            return
        await self.adapter.ensure_project(project)
        self._init_done.add(project)

    @staticmethod
    def _audit_detail(principal: Principal, detail: dict[str, Any]) -> dict[str, Any]:
        if principal.delegated_by is None:
            return detail
        return {**detail, "delegated_by": principal.delegated_by}

    async def _run(self, principal: Principal, project: str, permission: str, action: str, fn: Callable[[], Awaitable[Any]], *, issue_id: str | None = None, idem_key: str | None = None, idem_payload: Any = None, guard: MutationGuard | None = None) -> Any:
        self._authorize(principal, project, permission)
        req_hash = self.store.request_hash(action, project, idem_payload) if idem_key else None
        # Idempotency lookup lives inside the same per-project critical section as
        # the Beads mutation. This prevents two concurrent retries from both
        # observing a miss and creating duplicate work.
        async with self._locks[project]:
            if idem_key and req_hash:
                cached = self.store.get_idempotent(principal.subject, idem_key, req_hash)
                if cached is not None:
                    return cached[1]
            await self._ensure(project)
            try:
                if guard is not None:
                    await self._assert_mutation_guard(principal, project, guard)
                result = await fn()
            except Exception as exc:
                # Persist failure metadata, not backend error text: bd errors can
                # echo user-controlled issue prose or command arguments.
                detail = {"error_type": type(exc).__name__}
                returncode = getattr(exc, "returncode", None)
                if returncode is not None:
                    detail["returncode"] = returncode
                self.store.audit(
                    subject=principal.subject,
                    project=project,
                    action=action,
                    issue_id=issue_id,
                    ok=False,
                    detail=self._audit_detail(principal, detail),
                )
                raise
            self.store.audit(
                subject=principal.subject,
                project=project,
                action=action,
                issue_id=issue_id,
                ok=True,
                detail=self._audit_detail(
                    principal, {"result": self._audit_summary(result)}
                ),
            )
            if idem_key and req_hash:
                self.store.put_idempotent(principal.subject, idem_key, req_hash, 200, result)
            return result

    async def _assert_mutation_guard(
        self, principal: Principal, project: str, guard: MutationGuard
    ) -> None:
        issue = await self.adapter.get_issue(project, principal.subject, guard.issue_id)
        if not isinstance(issue, dict):
            raise GuardConflict("mutation guard could not resolve a valid issue")
        status = issue.get("status")
        assignee = issue.get("assignee")
        if guard.require_not_closed and status == "closed":
            action = "claim" if guard.kind == "claim" else "mutate"
            raise GuardConflict(
                f"Peer {principal.subject} cannot {action} closed issue {guard.issue_id}"
            )
        if guard.kind == "claim":
            if assignee:
                raise GuardConflict(
                    f"Peer {principal.subject} cannot claim issue {guard.issue_id} assigned to {assignee}"
                )
            return
        if assignee != principal.subject:
            raise GuardConflict(
                f"Peer {principal.subject} may mutate only an issue assigned to itself"
            )

    def projects(self, principal: Principal) -> list[dict[str, Any]]:
        out = []
        for p in self.registry.list():
            if principal.can(p.id, "read") or principal.can(p.id, "write") or principal.can(p.id, "admin"):
                out.append(p.model_dump())
        return out

    async def ensure_project(
        self, principal: Principal, project: str, req: ProjectEnsure
    ) -> dict[str, Any]:
        if "admin" not in principal.permissions or "*" not in principal.projects:
            raise Forbidden("global admin permission required to register a project")
        config = ProjectConfig(
            id=project, prefix=req.prefix, description=req.description, enabled=True
        )
        async with self._locks[project]:
            persisted, created = self.registry.ensure(config)
            try:
                await self._ensure(project)
            except Exception as exc:
                self.store.audit(
                    subject=principal.subject,
                    project=project,
                    action="project.ensure",
                    issue_id=None,
                    ok=False,
                    detail=self._audit_detail(
                        principal, {"error_type": type(exc).__name__, "created": created}
                    ),
                )
                raise
            result = {"project": persisted.model_dump(), "created": created}
            self.store.audit(
                subject=principal.subject,
                project=project,
                action="project.ensure",
                issue_id=None,
                ok=True,
                detail=self._audit_detail(
                    principal,
                    {"created": created, "prefix": persisted.prefix},
                ),
            )
            return result

    async def list_issues(
        self, principal: Principal, project: str, query: IssueListQuery
    ) -> Any:
        return await self._run(
            principal,
            project,
            "read",
            "issues.list",
            lambda: self.adapter.list_issues(project, principal.subject, query),
        )

    async def ready(
        self, principal: Principal, project: str, query: ReadyQuery
    ) -> Any:
        return await self._run(
            principal,
            project,
            "read",
            "issues.ready",
            lambda: self.adapter.ready(project, principal.subject, query),
        )

    async def get_issue(self, principal: Principal, project: str, issue_id: str) -> Any:
        issue_id = validate_issue_id(issue_id)
        return await self._run(principal, project, "read", "issue.get", lambda: self.adapter.get_issue(project, principal.subject, issue_id), issue_id=issue_id)

    async def create_issue(self, principal: Principal, project: str, req: IssueCreate) -> Any:
        if req.guard is not None and (
            req.guard.kind != "owned-mutation"
            or req.discovered_from != req.guard.issue_id
        ):
            raise GuardConflict("create guard must own the discovered-from issue")
        payload = req.model_dump(exclude={"idempotency_key"})
        return await self._run(principal, project, "write", "issue.create", lambda: self.adapter.create_issue(project, principal.subject, req), idem_key=req.idempotency_key, idem_payload=payload, guard=req.guard)

    async def claim_issue(self, principal: Principal, project: str, issue_id: str, req: ClaimRequest) -> Any:
        issue_id = validate_issue_id(issue_id)
        if req.guard is not None and (
            req.guard.kind != "claim" or req.guard.issue_id != issue_id
        ):
            raise GuardConflict("claim guard must match the claimed issue")
        return await self._run(principal, project, "write", "issue.claim", lambda: self.adapter.claim_issue(project, principal.subject, issue_id), issue_id=issue_id, idem_key=req.idempotency_key, idem_payload={"issue_id": issue_id, "guard": req.guard.model_dump() if req.guard else None}, guard=req.guard)

    async def update_issue(self, principal: Principal, project: str, issue_id: str, req: IssueUpdate) -> Any:
        issue_id = validate_issue_id(issue_id)
        if req.guard is not None and (
            req.guard.kind != "owned-mutation" or req.guard.issue_id != issue_id
        ):
            raise GuardConflict("update guard must match the updated issue")
        payload = req.model_dump(exclude={"idempotency_key"})
        return await self._run(principal, project, "write", "issue.update", lambda: self.adapter.update_issue(project, principal.subject, issue_id, req), issue_id=issue_id, idem_key=req.idempotency_key, idem_payload=payload, guard=req.guard)

    async def close_issue(self, principal: Principal, project: str, issue_id: str, req: CloseRequest) -> Any:
        issue_id = validate_issue_id(issue_id)
        return await self._run(principal, project, "write", "issue.close", lambda: self.adapter.close_issue(project, principal.subject, issue_id, req.reason), issue_id=issue_id, idem_key=req.idempotency_key, idem_payload={"reason": req.reason})

    async def add_dependency(self, principal: Principal, project: str, issue_id: str, req: DependencyCreate) -> Any:
        issue_id = validate_issue_id(issue_id)
        if req.guard is not None and (
            req.guard.kind != "owned-mutation" or req.guard.issue_id != issue_id
        ):
            raise GuardConflict("dependency guard must match the mutated issue")
        payload = req.model_dump(exclude={"idempotency_key"})

        async def add_and_read() -> Any:
            await self.adapter.add_dependency(
                project,
                principal.subject,
                issue_id,
                req.depends_on,
                req.dependency_type,
            )
            return await self.adapter.get_issue(project, principal.subject, issue_id)

        return await self._run(principal, project, "write", "dependency.add", add_and_read, issue_id=issue_id, idem_key=req.idempotency_key, idem_payload=payload, guard=req.guard)

    async def prime(self, principal: Principal, project: str) -> str:
        return await self._run(principal, project, "read", "project.prime", lambda: self.adapter.prime(project, principal.subject))
