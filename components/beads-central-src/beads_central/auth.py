from __future__ import annotations

import hmac
import re
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, Request, status


ACTOR_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$")


@dataclass(frozen=True)
class Principal:
    subject: str
    projects: frozenset[str]
    permissions: frozenset[str]
    delegated_by: str | None = None

    def can(self, project: str, permission: str) -> bool:
        has_permission = "admin" in self.permissions or permission in self.permissions
        return has_permission and ("*" in self.projects or project in self.projects)

    def delegate(self, actor: str) -> "Principal":
        if "admin" not in self.permissions or "*" not in self.projects:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="global admin permission required to delegate an actor",
            )
        if not ACTOR_RE.fullmatch(actor):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid delegated actor")
        return Principal(actor, self.projects, self.permissions, delegated_by=self.subject)


class TokenAuth:
    def __init__(self, tokens: dict[str, dict[str, Any]], insecure_dev: bool = False):
        allowed_permissions = {"read", "write", "admin"}
        if tokens and not insecure_dev:
            for token, config in tokens.items():
                if len(token) < 32:
                    raise RuntimeError("API bearer tokens must be at least 32 characters")
                if not isinstance(config, dict):
                    raise RuntimeError("each API token policy must be an object")
                projects = config.get("projects", [])
                permissions = config.get("permissions", ["read"])
                if not isinstance(projects, list) or not projects:
                    raise RuntimeError("each API token must grant at least one project")
                if not isinstance(permissions, list) or not permissions:
                    raise RuntimeError("each API token must grant at least one permission")
                unknown = set(map(str, permissions)) - allowed_permissions
                if unknown:
                    raise RuntimeError(f"unknown API token permissions: {sorted(unknown)}")
        self._tokens = tokens
        self._insecure_dev = insecure_dev

    def authenticate_header(self, authorization: str | None) -> Principal:
        if self._insecure_dev and not self._tokens:
            return Principal("insecure-dev", frozenset({"*"}), frozenset({"read", "write", "admin"}))
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
        supplied = authorization[7:]
        match: dict[str, Any] | None = None
        for token, config in self._tokens.items():
            if hmac.compare_digest(token, supplied):
                match = config
                break
        if match is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid bearer token")
        subject = str(match.get("subject", "agent"))
        projects = frozenset(str(v) for v in match.get("projects", []))
        permissions = frozenset(str(v) for v in match.get("permissions", ["read"]))
        return Principal(subject, projects, permissions)

    def authenticate_request(self, request: Request) -> Principal:
        principal = self.authenticate_header(request.headers.get("authorization"))
        actor = request.headers.get("x-paseo-actor")
        return principal.delegate(actor) if actor is not None else principal
