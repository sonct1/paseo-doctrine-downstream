from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Settings:
    config_path: Path
    data_dir: Path
    bd_bin: str
    command_timeout_seconds: float
    insecure_dev: bool
    tokens: dict[str, dict[str, Any]]
    max_body_bytes: int

    def __post_init__(self) -> None:
        if self.command_timeout_seconds <= 0:
            raise ValueError("command_timeout_seconds must be > 0")
        if self.max_body_bytes <= 0:
            raise ValueError("max_body_bytes must be > 0")

    @classmethod
    def from_env(cls) -> "Settings":
        config_path = Path(os.getenv("BEADS_CENTRAL_CONFIG", "config/projects.yaml")).resolve()
        data_dir = Path(os.getenv("BEADS_CENTRAL_DATA", "data")).resolve()
        bd_bin = os.getenv("BEADS_CENTRAL_BD_BIN", "bd")
        timeout = float(os.getenv("BEADS_CENTRAL_COMMAND_TIMEOUT", "30"))
        insecure_dev = os.getenv("BEADS_CENTRAL_INSECURE_DEV", "0").lower() in {"1", "true", "yes"}
        raw_tokens = os.getenv("BEADS_CENTRAL_TOKENS_JSON", "{}")
        try:
            tokens = json.loads(raw_tokens)
        except json.JSONDecodeError as exc:
            raise RuntimeError("BEADS_CENTRAL_TOKENS_JSON must be valid JSON") from exc
        if not isinstance(tokens, dict):
            raise RuntimeError("BEADS_CENTRAL_TOKENS_JSON must be a JSON object")
        if not tokens and not insecure_dev:
            raise RuntimeError(
                "No API tokens configured. Set BEADS_CENTRAL_TOKENS_JSON or explicitly set "
                "BEADS_CENTRAL_INSECURE_DEV=1 for local-only development."
            )
        max_body_bytes = int(os.getenv("BEADS_CENTRAL_MAX_BODY_BYTES", str(1024 * 1024)))
        return cls(
            config_path=config_path,
            data_dir=data_dir,
            bd_bin=bd_bin,
            command_timeout_seconds=timeout,
            insecure_dev=insecure_dev,
            tokens=tokens,
            max_body_bytes=max_body_bytes,
        )
