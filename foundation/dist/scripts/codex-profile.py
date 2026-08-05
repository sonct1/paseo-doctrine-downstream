#!/usr/bin/env python3
"""Launch Codex with one role profile translated to CLI config overrides."""

from __future__ import annotations

import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import tomllib
from typing import Any, Iterator, NoReturn


BARE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")
MUTABLE_PROFILE_KEYS = {"model", "model_reasoning_effort"}


def key(value: str) -> str:
    return value if BARE_KEY.fullmatch(value) else json.dumps(value, ensure_ascii=False)


def encode(value: Any) -> str:
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value):
            return "nan"
        if math.isinf(value):
            return "inf" if value > 0 else "-inf"
        return repr(value)
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, list):
        return "[" + ", ".join(encode(item) for item in value) + "]"
    if isinstance(value, dict):
        fields = ", ".join(f"{key(name)} = {encode(item)}" for name, item in value.items())
        return "{ " + fields + " }"
    raise TypeError(f"Unsupported TOML value: {type(value).__name__}")


def overrides(table: dict[str, Any], path: tuple[str, ...] = ()) -> Iterator[str]:
    for name, value in table.items():
        current = path + (name,)
        if isinstance(value, dict) and value:
            yield from overrides(value, current)
        elif not isinstance(value, dict):
            yield f"{'.'.join(key(part) for part in current)}={encode(value)}"


def profile_path(selector: str, codex_home: Path) -> Path:
    candidate = Path(selector).expanduser()
    if candidate.suffix.lower() == ".toml" or candidate.parent != Path("."):
        return candidate.resolve()
    return codex_home / f"{selector}.config.toml"


def validate_paseo_profile(profile: dict[str, Any], source: Path) -> None:
    features = profile.get("features")
    if not isinstance(features, dict):
        raise ValueError(f"Paseo Codex profile has no [features] table: {source}")
    for flag in ("multi_agent", "multi_agent_v2"):
        if features.get(flag) is not False:
            raise ValueError(f"Paseo Codex profile must set features.{flag}=false: {source}")
    agents = profile.get("agents")
    if not isinstance(agents, dict) or agents.get("enabled") is not False:
        raise ValueError(f"Paseo Codex profile must set agents.enabled=false: {source}")


def flattened_profile_keys(table: dict[str, Any], path: tuple[str, ...] = ()) -> set[str]:
    keys: set[str] = set()
    for name, value in table.items():
        current = path + (name,)
        if isinstance(value, dict) and value:
            keys.update(flattened_profile_keys(value, current))
        elif not isinstance(value, dict):
            keys.add(".".join(current))
    return keys


def config_key_conflicts(raw: str, protected: set[str]) -> bool:
    candidate = raw.partition("=")[0].strip()
    return any(
        candidate == key or candidate.startswith(f"{key}.") or key.startswith(f"{candidate}.")
        for key in protected
    )


def validate_caller_args(codex_args: list[str], profile: dict[str, Any]) -> None:
    protected = flattened_profile_keys(profile) - MUTABLE_PROFILE_KEYS
    index = 0
    while index < len(codex_args):
        argument = codex_args[index]
        if argument == "--":
            return
        if argument in {"-p", "--profile"} or argument.startswith(("-p", "--profile=")):
            raise ValueError("caller must not add another Codex profile to a Paseo standing role")
        if argument in {"-c", "--config"}:
            if index + 1 < len(codex_args) and config_key_conflicts(
                codex_args[index + 1], protected
            ):
                raise ValueError(
                    f"caller must not override Paseo standing profile key: {codex_args[index + 1].partition('=')[0].strip()}"
                )
            index += 2
            continue
        if argument.startswith(("-c=", "--config=")):
            raw = argument.split("=", 1)[1]
            if config_key_conflicts(raw, protected):
                raise ValueError(
                    f"caller must not override Paseo standing profile key: {raw.partition('=')[0].strip()}"
                )
        elif argument.startswith("-c") and len(argument) > 2:
            raw = argument[2:]
            if config_key_conflicts(raw, protected):
                raise ValueError(
                    f"caller must not override Paseo standing profile key: {raw.partition('=')[0].strip()}"
                )
        if argument in {"--enable", "--disable"}:
            if index + 1 < len(codex_args) and config_key_conflicts(
                f"features.{codex_args[index + 1]}", protected
            ):
                raise ValueError(
                    f"caller must not override Paseo standing profile feature: {codex_args[index + 1]}"
                )
            index += 2
            continue
        if argument.startswith(("--enable=", "--disable=")):
            feature = argument.split("=", 1)[1]
            if config_key_conflicts(f"features.{feature}", protected):
                raise ValueError(
                    f"caller must not override Paseo standing profile feature: {feature}"
                )
        index += 1


def main() -> NoReturn:
    if len(sys.argv) < 3:
        print("usage: codex-profile <profile-name|profile.toml> <codex args...>", file=sys.stderr)
        raise SystemExit(2)

    selector, *codex_args = sys.argv[1:]
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")).expanduser().resolve()
    source = profile_path(selector, codex_home)

    with source.open("rb") as handle:
        profile = tomllib.load(handle)
    validate_paseo_profile(profile, source)
    validate_caller_args(codex_args, profile)

    codex = shutil.which("codex")
    if not codex:
        raise FileNotFoundError("codex was not found on PATH")

    command = [codex]
    for override in overrides(profile):
        command.extend(("-c", override))
    command.extend(codex_args)
    os.execvpe(codex, command, os.environ.copy())


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        print(f"codex-profile: {error}", file=sys.stderr)
        raise SystemExit(1)
