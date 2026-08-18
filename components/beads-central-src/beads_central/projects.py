from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import threading

import yaml
from pydantic import ValidationError

from .models import ProjectConfig


class ProjectBindingConflict(ValueError):
    pass


class ProjectRegistry:
    def __init__(self, config_path: Path, data_dir: Path):
        self.config_path = config_path
        self.data_dir = data_dir
        self.dynamic_path = data_dir / "projects.json"
        self._lock = threading.RLock()
        self._projects: dict[str, ProjectConfig] = {}
        self._static_ids: set[str] = set()
        self.reload()

    def reload(self) -> None:
        if not self.config_path.exists():
            raise RuntimeError(f"project config not found: {self.config_path}")
        raw = yaml.safe_load(self.config_path.read_text()) or {}
        entries = raw.get("projects", [])
        if isinstance(entries, dict):
            entries = [dict({"id": k}, **(v or {})) for k, v in entries.items()]
        if not isinstance(entries, list):
            raise RuntimeError("projects must be a list or mapping")
        parsed: dict[str, ProjectConfig] = {}
        prefixes: set[str] = set()
        try:
            for item in entries:
                project = ProjectConfig.model_validate(item)
                if project.id in parsed:
                    raise RuntimeError(f"duplicate project id: {project.id}")
                if project.prefix in prefixes:
                    raise RuntimeError(f"duplicate Beads prefix: {project.prefix}")
                if project.enabled:
                    parsed[project.id] = project
                    prefixes.add(project.prefix)
        except ValidationError as exc:
            raise RuntimeError(f"invalid project config: {exc}") from exc
        static_ids = set(parsed)
        if self.dynamic_path.exists():
            try:
                dynamic_raw = json.loads(self.dynamic_path.read_text())
            except (OSError, json.JSONDecodeError) as exc:
                raise RuntimeError(f"invalid dynamic project registry: {exc}") from exc
            dynamic_entries = dynamic_raw.get("projects", []) if isinstance(dynamic_raw, dict) else None
            if not isinstance(dynamic_entries, list):
                raise RuntimeError("dynamic projects must be a list")
            try:
                for item in dynamic_entries:
                    project = ProjectConfig.model_validate(item)
                    if not project.enabled:
                        continue
                    if project.id in parsed:
                        raise RuntimeError(f"duplicate project id: {project.id}")
                    if project.prefix in prefixes:
                        raise RuntimeError(f"duplicate Beads prefix: {project.prefix}")
                    parsed[project.id] = project
                    prefixes.add(project.prefix)
            except ValidationError as exc:
                raise RuntimeError(f"invalid dynamic project config: {exc}") from exc
        with self._lock:
            self._projects = parsed
            self._static_ids = static_ids

    def _persist_dynamic(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        projects = [
            project.model_dump()
            for project_id, project in sorted(self._projects.items())
            if project_id not in self._static_ids
        ]
        payload = json.dumps({"version": 1, "projects": projects}, sort_keys=True, indent=2) + "\n"
        fd, temporary = tempfile.mkstemp(prefix=".projects.", suffix=".tmp", dir=self.data_dir)
        try:
            with os.fdopen(fd, "w") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.dynamic_path)
            directory_fd = os.open(self.data_dir, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def ensure(self, project: ProjectConfig) -> tuple[ProjectConfig, bool]:
        with self._lock:
            current = self._projects.get(project.id)
            if current is not None:
                if current.prefix != project.prefix:
                    raise ProjectBindingConflict(
                        f"project {project.id} is already bound to prefix {current.prefix}"
                    )
                if project.id in self._static_ids or current.description == project.description:
                    return current, False
                updated = current.model_copy(update={"description": project.description})
                self._projects[project.id] = updated
                try:
                    self._persist_dynamic()
                except Exception:
                    self._projects[project.id] = current
                    raise
                return updated, False
            for existing in self._projects.values():
                if existing.prefix == project.prefix:
                    raise ProjectBindingConflict(
                        f"Beads prefix {project.prefix} is already bound to project {existing.id}"
                    )
            self._projects[project.id] = project
            try:
                self._persist_dynamic()
            except Exception:
                del self._projects[project.id]
                raise
            return project, True

    def list(self) -> list[ProjectConfig]:
        with self._lock:
            return sorted(self._projects.values(), key=lambda p: p.id)

    def get(self, project_id: str) -> ProjectConfig:
        with self._lock:
            try:
                return self._projects[project_id]
            except KeyError as exc:
                raise KeyError(f"unknown project: {project_id}") from exc

    def workspace(self, project_id: str) -> Path:
        project = self.get(project_id)
        root = (self.data_dir / "projects").resolve()
        path = (root / project.id).resolve()
        if root not in path.parents:
            raise RuntimeError("project path escaped data root")
        return path
