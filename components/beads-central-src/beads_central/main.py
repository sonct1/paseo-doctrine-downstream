from __future__ import annotations

from contextlib import asynccontextmanager
import json
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from .auth import Principal, TokenAuth
from . import __version__
from .beads import BeadsAdapter, BeadsError
from .body_limit import BodySizeLimitMiddleware
from .control_store import ControlStore, IdempotencyConflict
from .mcp import handle_mcp
from .instance_lock import InstanceLock
from .models import (
    ClaimRequest,
    CloseRequest,
    DependencyCreate,
    IssueCreate,
    IssueListQuery,
    IssueType,
    IssueUpdate,
    ProjectEnsure,
    ReadyQuery,
)
from .projects import ProjectBindingConflict, ProjectRegistry
from .service import CentralService, Forbidden, GuardConflict
from .settings import Settings


def create_app(settings: Settings | None = None, *, adapter: BeadsAdapter | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    registry = ProjectRegistry(settings.config_path, settings.data_dir)
    auth = TokenAuth(settings.tokens, settings.insecure_dev)
    adapter = adapter or BeadsAdapter(registry, settings.bd_bin, settings.command_timeout_seconds)
    store = ControlStore(settings.data_dir / "control.sqlite3")
    service = CentralService(registry, adapter, store)
    instance_lock = InstanceLock(settings.data_dir / ".beads-central.lock")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            instance_lock.acquire()
        except Exception:
            store.close()
            raise
        app.state.settings = settings
        app.state.registry = registry
        app.state.auth = auth
        app.state.adapter = adapter
        app.state.store = store
        app.state.service = service
        try:
            yield
        finally:
            try:
                store.close()
            finally:
                instance_lock.release()

    app = FastAPI(title="Beads Central", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)

    async def principal(request: Request) -> Principal:
        return auth.authenticate_request(request)

    @app.exception_handler(Forbidden)
    async def forbidden_handler(_: Request, exc: Forbidden):
        return JSONResponse(status_code=403, content={"detail": str(exc)})

    @app.exception_handler(KeyError)
    async def key_handler(_: Request, exc: KeyError):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(BeadsError)
    async def beads_handler(_: Request, exc: BeadsError):
        return JSONResponse(status_code=502, content={"detail": str(exc), "backend": "beads"})

    @app.exception_handler(IdempotencyConflict)
    async def idem_handler(_: Request, exc: IdempotencyConflict):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(ProjectBindingConflict)
    async def project_conflict_handler(_: Request, exc: ProjectBindingConflict):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(GuardConflict)
    async def guard_conflict_handler(_: Request, exc: GuardConflict):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(ValueError)
    async def value_handler(_: Request, exc: ValueError):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.get("/health/live")
    async def live():
        return {"status": "ok"}

    @app.get("/health/ready")
    async def ready_health():
        try:
            version = await adapter.version()
        except Exception as exc:
            return JSONResponse(status_code=503, content={"status": "not_ready", "error": str(exc)})
        return {
            "status": "ready",
            "central": __version__,
            "bd": version,
            "projects": len(registry.list()),
        }

    @app.get("/metrics", response_class=PlainTextResponse)
    async def metrics(p: Principal = Depends(principal)):
        if "admin" not in p.permissions or "*" not in p.projects:
            raise HTTPException(status_code=403, detail="global admin permission required")
        projects = len(registry.list())
        return f"beads_central_up 1\nbeads_central_projects {projects}\n"

    @app.get("/v1/projects")
    async def list_projects(p: Principal = Depends(principal)):
        return {"projects": service.projects(p)}

    @app.put("/v1/admin/projects/{project}")
    async def ensure_project(
        project: str, req: ProjectEnsure, p: Principal = Depends(principal)
    ):
        return {"result": await service.ensure_project(p, project, req)}

    @app.get("/v1/projects/{project}/issues")
    async def list_issues(
        project: str,
        status_filter: str | None = None,
        issue_type: IssueType | None = None,
        priority: int | None = None,
        assignee: str | None = None,
        label: list[str] = Query(default=[]),
        limit: int = 50,
        p: Principal = Depends(principal),
    ):
        statuses = status_filter.split(",") if status_filter else []
        query = IssueListQuery(
            statuses=statuses,
            issue_type=issue_type,
            priority=priority,
            assignee=assignee,
            labels=label,
            limit=limit,
        )
        return {"result": await service.list_issues(p, project, query)}

    @app.get("/v1/projects/{project}/ready")
    async def ready(
        project: str,
        issue_type: IssueType | None = None,
        priority: int | None = None,
        assignee: str | None = None,
        label: list[str] = Query(default=[]),
        limit: int = 100,
        p: Principal = Depends(principal),
    ):
        query = ReadyQuery(
            issue_type=issue_type,
            priority=priority,
            assignee=assignee,
            labels=label,
            limit=limit,
        )
        return {"result": await service.ready(p, project, query)}

    @app.get("/v1/projects/{project}/issues/{issue_id}")
    async def get_issue(project: str, issue_id: str, p: Principal = Depends(principal)):
        return {"result": await service.get_issue(p, project, issue_id)}

    @app.post("/v1/projects/{project}/issues", status_code=201)
    async def create_issue(project: str, req: IssueCreate, p: Principal = Depends(principal)):
        return {"result": await service.create_issue(p, project, req)}

    @app.post("/v1/projects/{project}/issues/{issue_id}/claim")
    async def claim_issue(project: str, issue_id: str, req: ClaimRequest, p: Principal = Depends(principal)):
        return {"result": await service.claim_issue(p, project, issue_id, req)}

    @app.patch("/v1/projects/{project}/issues/{issue_id}")
    async def update_issue(project: str, issue_id: str, req: IssueUpdate, p: Principal = Depends(principal)):
        return {"result": await service.update_issue(p, project, issue_id, req)}

    @app.post("/v1/projects/{project}/issues/{issue_id}/close")
    async def close_issue(project: str, issue_id: str, req: CloseRequest, p: Principal = Depends(principal)):
        return {"result": await service.close_issue(p, project, issue_id, req)}

    @app.post("/v1/projects/{project}/issues/{issue_id}/dependencies", status_code=201)
    async def add_dep(project: str, issue_id: str, req: DependencyCreate, p: Principal = Depends(principal)):
        return {"result": await service.add_dependency(p, project, issue_id, req)}

    @app.get("/v1/projects/{project}/prime")
    async def prime(project: str, p: Principal = Depends(principal)):
        return {"result": await service.prime(p, project)}

    @app.get("/v1/admin/audit")
    async def audit(project: str | None = None, limit: int = 100, p: Principal = Depends(principal)):
        if "admin" not in p.permissions:
            raise HTTPException(status_code=403, detail="admin permission required")
        if project is not None:
            if not p.can(project, "admin"):
                raise HTTPException(status_code=403, detail=f"admin access to {project} required")
            registry.get(project)
            return {"events": store.audit_tail(project, limit)}
        return {"events": store.audit_tail_scoped(p.projects, limit)}

    @app.post("/mcp")
    async def mcp(request: Request, p: Principal = Depends(principal)):
        try:
            body: Any = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JSONResponse(status_code=400, content={"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
        code, response = await handle_mcp(service, p, body, {k.lower(): v for k, v in request.headers.items()})
        if response is None:
            return Response(status_code=code)
        return JSONResponse(status_code=code, content=response)

    return app
