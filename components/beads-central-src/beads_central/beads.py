from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any

from .models import IssueCreate, IssueListQuery, IssueUpdate, ReadyQuery
from .projects import ProjectRegistry


class BeadsError(RuntimeError):
    def __init__(self, message: str, *, command: list[str] | None = None, stderr: str = "", returncode: int | None = None):
        super().__init__(message)
        self.command = command or []
        self.stderr = stderr
        self.returncode = returncode


class BeadsAdapter:
    def __init__(self, registry: ProjectRegistry, bd_bin: str = "bd", timeout_seconds: float = 30.0):
        self.registry = registry
        self.bd_bin = bd_bin
        self.timeout_seconds = timeout_seconds

    def _env(self, project_id: str, actor: str) -> dict[str, str]:
        # Do not leak service secrets (notably BEADS_CENTRAL_TOKENS_JSON) into
        # child processes. bd only needs a small OS/runtime environment plus the
        # explicitly controlled Beads settings below.
        inherited = (
            "PATH", "HOME", "TMPDIR", "TEMP", "TMP",
            "LANG", "LC_ALL", "LC_CTYPE", "TZ",
            "SSL_CERT_FILE", "SSL_CERT_DIR",
        )
        env = {key: os.environ[key] for key in inherited if key in os.environ}
        workspace = self.registry.workspace(project_id)
        env["BEADS_DIR"] = str(workspace / ".beads")
        # BEADS_ACTOR is the preferred upstream name; BD_ACTOR remains a
        # compatibility alias and is useful with older bd builds/test doubles.
        env["BEADS_ACTOR"] = actor
        env["BD_ACTOR"] = actor
        env["NO_COLOR"] = "1"
        env["TERM"] = "dumb"
        # Embedded mode is intentional in v1. Disable Dolt's default metrics
        # event flush so an internal tracker does not make surprise outbound calls.
        env["DOLT_DISABLE_EVENT_FLUSH"] = "1"
        return env

    async def _run(self, project_id: str, actor: str, args: list[str], *, stdin: str | None = None, json_output: bool = True) -> Any:
        workspace = self.registry.workspace(project_id)
        workspace.mkdir(parents=True, exist_ok=True)
        cmd = [self.bd_bin, *args]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=workspace,
                env=self._env(project_id, actor),
                stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            raise BeadsError(f"Beads binary not found: {self.bd_bin}", command=cmd) from exc
        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(stdin.encode() if stdin is not None else None),
                timeout=self.timeout_seconds,
            )
        except TimeoutError as exc:
            proc.kill()
            await proc.wait()
            raise BeadsError(f"Beads command timed out after {self.timeout_seconds}s", command=cmd) from exc
        stdout = stdout_b.decode("utf-8", errors="replace").strip()
        stderr = stderr_b.decode("utf-8", errors="replace").strip()
        if proc.returncode != 0:
            message = stderr or stdout or f"bd exited with {proc.returncode}"
            raise BeadsError(message, command=cmd, stderr=stderr, returncode=proc.returncode)
        if not json_output:
            return stdout
        if not stdout:
            return None
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            # Defensive compatibility: tolerate informational lines before a final JSON value.
            lines = [line.strip() for line in stdout.splitlines() if line.strip()]
            for i in range(len(lines)):
                candidate = "\n".join(lines[i:])
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    continue
            raise BeadsError("bd returned non-JSON output for a JSON command", command=cmd, stderr=stderr)

    async def version(self) -> str:
        try:
            proc = await asyncio.create_subprocess_exec(
                self.bd_bin, "version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "TEMP", "TMP") if key in os.environ},
            )
        except FileNotFoundError as exc:
            raise BeadsError(f"Beads binary not found: {self.bd_bin}") from exc
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self.timeout_seconds)
        except TimeoutError as exc:
            proc.kill()
            await proc.wait()
            raise BeadsError(f"Beads version command timed out after {self.timeout_seconds}s") from exc
        if proc.returncode != 0:
            raise BeadsError((stderr or stdout).decode(errors="replace"))
        return stdout.decode(errors="replace").strip()

    async def ensure_project(self, project_id: str, actor: str = "beads-central") -> None:
        project = self.registry.get(project_id)
        workspace = self.registry.workspace(project_id)
        beads_dir = workspace / ".beads"
        if (beads_dir / "metadata.json").exists() or (beads_dir / "config.yaml").exists():
            return
        workspace.mkdir(parents=True, exist_ok=True)
        # v1.1+ supports idempotent init. --stealth avoids git integration entirely.
        await self._run(
            project_id,
            actor,
            ["init", "--init-if-missing", "--quiet", "--non-interactive", "--prefix", project.prefix, "--stealth", "--skip-hooks", "--skip-agents"],
            json_output=False,
        )

    async def list_issues(self, project_id: str, actor: str, query: IssueListQuery) -> Any:
        args = ["list", "--all", "--flat", "--json"]
        if query.statuses:
            args += [f"--status={','.join(query.statuses)}"]
        if query.issue_type:
            args += [f"--type={query.issue_type}"]
        if query.priority is not None:
            args += [f"--priority={query.priority}"]
        if query.assignee:
            args += [f"--assignee={query.assignee}"]
        for label in query.labels:
            args += [f"--label={label}"]
        args += [f"--limit={query.limit}"]
        return await self._run(project_id, actor, args)

    async def ready(self, project_id: str, actor: str, query: ReadyQuery) -> Any:
        args = ["ready", "--json"]
        if query.issue_type:
            args += [f"--type={query.issue_type}"]
        if query.priority is not None:
            args += [f"--priority={query.priority}"]
        if query.assignee:
            args += [f"--assignee={query.assignee}"]
        for label in query.labels:
            args += [f"--label={label}"]
        args += [f"--limit={query.limit}"]
        return await self._run(project_id, actor, args)

    @staticmethod
    def _single_issue_result(value: Any, operation: str) -> Any:
        # Beads 1.1.2 emits arrays for show/update/close JSON even when exactly
        # one ID was requested. Beads Central exposes a stable single-object API.
        if isinstance(value, list):
            if len(value) != 1:
                raise BeadsError(f"bd {operation} returned {len(value)} results for one issue")
            return value[0]
        return value

    async def get_issue(self, project_id: str, actor: str, issue_id: str) -> Any:
        value = await self._run(project_id, actor, ["show", issue_id, "--json"])
        return self._single_issue_result(value, "show")

    async def create_issue(self, project_id: str, actor: str, req: IssueCreate) -> Any:
        args = ["create", f"--title={req.title}", f"--type={req.issue_type}", f"--priority={req.priority}", "--json"]
        if req.description:
            args += [f"--description={req.description}"]
        if req.acceptance:
            args += [f"--acceptance={req.acceptance}"]
        if req.design:
            args += [f"--design={req.design}"]
        for label in req.labels:
            args += [f"--label={label}"]
        if req.discovered_from:
            args += [f"--deps=discovered-from:{req.discovered_from}"]
        return await self._run(project_id, actor, args)

    async def claim_issue(self, project_id: str, actor: str, issue_id: str) -> Any:
        value = await self._run(project_id, actor, ["update", issue_id, "--claim", "--json"])
        return self._single_issue_result(value, "update --claim")

    async def update_issue(self, project_id: str, actor: str, issue_id: str, req: IssueUpdate) -> Any:
        args = ["update", issue_id]
        if req.title is not None:
            args += [f"--title={req.title}"]
        if req.description is not None:
            args += [f"--description={req.description}"]
        if req.acceptance is not None:
            args += [f"--acceptance={req.acceptance}"]
        if req.design is not None:
            args += [f"--design={req.design}"]
        if req.priority is not None:
            args += [f"--priority={req.priority}"]
        if req.status is not None:
            args += [f"--status={req.status}"]
        if req.assignee is not None:
            args += [f"--assignee={req.assignee}"]
        if req.append_notes is not None:
            args += [f"--append-notes={req.append_notes}"]
        for label in req.add_labels:
            args += [f"--add-label={label}"]
        for label in req.remove_labels:
            args += [f"--remove-label={label}"]
        if len(args) == 2:
            return await self.get_issue(project_id, actor, issue_id)
        args += ["--json"]
        value = await self._run(project_id, actor, args)
        return self._single_issue_result(value, "update")

    async def close_issue(self, project_id: str, actor: str, issue_id: str, reason: str) -> Any:
        value = await self._run(project_id, actor, ["close", issue_id, f"--reason={reason}", "--json"])
        return self._single_issue_result(value, "close")

    async def add_dependency(self, project_id: str, actor: str, issue_id: str, depends_on: str, dependency_type: str) -> Any:
        args = ["dep", "add", issue_id, depends_on]
        if dependency_type != "blocks":
            args += [f"--type={dependency_type}"]
        args += ["--json"]
        return await self._run(project_id, actor, args)

    async def prime(self, project_id: str, actor: str) -> str:
        return await self._run(project_id, actor, ["prime"], json_output=False)
