from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any


class IdempotencyConflict(RuntimeError):
    pass


class ControlStore:
    """Operational metadata only. Beads remains the source of truth for issues."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=FULL")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS audit (
              seq INTEGER PRIMARY KEY AUTOINCREMENT,
              ts REAL NOT NULL,
              subject TEXT NOT NULL,
              project TEXT,
              action TEXT NOT NULL,
              issue_id TEXT,
              ok INTEGER NOT NULL,
              detail TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_audit_project_ts ON audit(project, ts);
            CREATE TABLE IF NOT EXISTS idempotency (
              subject TEXT NOT NULL,
              key TEXT NOT NULL,
              request_hash TEXT NOT NULL,
              status_code INTEGER NOT NULL,
              response_json TEXT NOT NULL,
              created_at REAL NOT NULL,
              PRIMARY KEY(subject, key)
            );
            """
        )
        self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    @staticmethod
    def request_hash(action: str, project: str, payload: Any) -> str:
        canonical = json.dumps({"action": action, "project": project, "payload": payload}, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()

    def audit(self, *, subject: str, project: str | None, action: str, issue_id: str | None, ok: bool, detail: Any) -> None:
        encoded = json.dumps(detail, sort_keys=True, default=str, separators=(",", ":"))
        with self._lock:
            self._conn.execute(
                "INSERT INTO audit(ts,subject,project,action,issue_id,ok,detail) VALUES(?,?,?,?,?,?,?)",
                (time.time(), subject, project, action, issue_id, 1 if ok else 0, encoded),
            )
            self._conn.commit()

    def get_idempotent(self, subject: str, key: str, request_hash: str) -> tuple[int, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT request_hash,status_code,response_json FROM idempotency WHERE subject=? AND key=?",
                (subject, key),
            ).fetchone()
        if row is None:
            return None
        if row[0] != request_hash:
            raise IdempotencyConflict("idempotency key was already used with a different request")
        return int(row[1]), json.loads(row[2])

    def put_idempotent(self, subject: str, key: str, request_hash: str, status_code: int, response: Any) -> None:
        encoded = json.dumps(response, sort_keys=True, default=str, separators=(",", ":"))
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO idempotency(subject,key,request_hash,status_code,response_json,created_at) VALUES(?,?,?,?,?,?)",
                (subject, key, request_hash, status_code, encoded, time.time()),
            )
            self._conn.commit()


    def audit_tail_scoped(self, projects: frozenset[str], limit: int = 100) -> list[dict[str, Any]]:
        """Return audit events visible to a project-scoped administrator."""
        if "*" in projects:
            return self.audit_tail(None, limit)
        allowed = sorted(projects)
        if not allowed:
            return []
        limit = max(1, min(limit, 1000))
        placeholders = ",".join("?" for _ in allowed)
        with self._lock:
            rows = self._conn.execute(
                f"SELECT seq,ts,subject,project,action,issue_id,ok,detail FROM audit "
                f"WHERE project IN ({placeholders}) ORDER BY seq DESC LIMIT ?",
                (*allowed, limit),
            ).fetchall()
        return [
            {"seq": r[0], "ts": r[1], "subject": r[2], "project": r[3], "action": r[4], "issue_id": r[5], "ok": bool(r[6]), "detail": json.loads(r[7])}
            for r in rows
        ]

    def audit_tail(self, project: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 1000))
        with self._lock:
            if project:
                rows = self._conn.execute(
                    "SELECT seq,ts,subject,project,action,issue_id,ok,detail FROM audit WHERE project=? ORDER BY seq DESC LIMIT ?",
                    (project, limit),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT seq,ts,subject,project,action,issue_id,ok,detail FROM audit ORDER BY seq DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        return [
            {"seq": r[0], "ts": r[1], "subject": r[2], "project": r[3], "action": r[4], "issue_id": r[5], "ok": bool(r[6]), "detail": json.loads(r[7])}
            for r in rows
        ]
