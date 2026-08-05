#!/usr/bin/env python3
"""Launch one Codex Paseo role through the local cliproxyapi Responses route."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import stat
import sys
from typing import NoReturn
from urllib.parse import urlsplit, urlunsplit


ROLES = {"lead", "peer", "supervisor"}
PROVIDER_ID = "cliproxyapi"
FOUNDATION_ROOT = Path(__file__).resolve().parent.parent
CODEX_PROFILE_ROOT = FOUNDATION_ROOT / "profiles" / "codex"
PROTECTED_CONFIG_ROOTS = {
    "model_provider",
    "model_providers",
    "openai_base_url",
}


def toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def toml_string_array(values: list[str]) -> str:
    return "[" + ", ".join(toml_string(value) for value in values) + "]"


def normalized_base_url(raw: str) -> str:
    value = raw.strip().rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "PASEO_CLIPROXY_BASE_URL must be an absolute https URL without credentials, query or fragment"
        )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def validate_auth_file(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"cliproxyapi auth file does not exist: {path}")
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        raise PermissionError(f"cliproxyapi auth file must not be group/world accessible: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    key = payload.get("OPENAI_API_KEY") if isinstance(payload, dict) else None
    if not isinstance(key, str) or not key.strip():
        raise ValueError(f"cliproxyapi auth file must contain a non-empty OPENAI_API_KEY: {path}")


def protected_config_override(raw: str) -> str | None:
    key = raw.partition("=")[0].strip()
    if any(key == root or key.startswith(f"{root}.") for root in PROTECTED_CONFIG_ROOTS):
        return key
    return None


def validate_caller_args(codex_args: list[str]) -> None:
    index = 0
    while index < len(codex_args):
        argument = codex_args[index]
        if argument == "--":
            return
        if argument in {"--oss", "--remote"} or argument.startswith("--remote="):
            raise ValueError(f"caller must not switch the exact cliproxyapi route with {argument}")
        if argument in {"--local-provider"} or argument.startswith("--local-provider="):
            raise ValueError("caller must not switch the exact cliproxyapi route with --local-provider")
        if argument in {"-c", "--config"}:
            if index + 1 < len(codex_args):
                protected = protected_config_override(codex_args[index + 1])
                if protected:
                    raise ValueError(f"caller must not override protected provider key: {protected}")
            index += 2
            continue
        if argument.startswith(("-c=", "--config=")):
            protected = protected_config_override(argument.split("=", 1)[1])
            if protected:
                raise ValueError(f"caller must not override protected provider key: {protected}")
        elif argument.startswith("-c") and len(argument) > 2:
            protected = protected_config_override(argument[2:])
            if protected:
                raise ValueError(f"caller must not override protected provider key: {protected}")
        index += 1


def main() -> NoReturn:
    if len(sys.argv) < 3:
        print("usage: codex-cliproxy-profile <lead|peer|supervisor> <codex args...>", file=sys.stderr)
        raise SystemExit(2)

    role, *codex_args = sys.argv[1:]
    if role not in ROLES:
        raise ValueError(f"unsupported Paseo Codex role: {role}")
    validate_caller_args(codex_args)

    raw_auth_file = os.environ.get("PASEO_CLIPROXY_AUTH_FILE")
    if not raw_auth_file:
        raise ValueError("PASEO_CLIPROXY_AUTH_FILE is required")
    auth_file = Path(raw_auth_file).expanduser().resolve()
    validate_auth_file(auth_file)

    raw_base_url = os.environ.get("PASEO_CLIPROXY_BASE_URL")
    if not raw_base_url:
        raise ValueError("PASEO_CLIPROXY_BASE_URL is required")
    base_url = normalized_base_url(raw_base_url)
    jq = Path("/usr/bin/jq")
    if not jq.is_file():
        resolved_jq = shutil.which("jq")
        if not resolved_jq:
            raise FileNotFoundError("jq was not found; command-backed cliproxyapi auth cannot run")
        jq = Path(resolved_jq).resolve()

    profile_launcher = Path(__file__).resolve().with_name("codex-profile")
    if not profile_launcher.is_file():
        raise FileNotFoundError(f"codex-profile launcher does not exist: {profile_launcher}")
    profile_source = CODEX_PROFILE_ROOT / f"{role}.config.toml"
    if not profile_source.is_file():
        raise FileNotFoundError(f"canonical Paseo Codex profile does not exist: {profile_source}")

    overrides = (
        "model_provider=" + toml_string(PROVIDER_ID),
        f"model_providers.{PROVIDER_ID}.name=" + toml_string(PROVIDER_ID),
        f"model_providers.{PROVIDER_ID}.base_url=" + toml_string(base_url),
        f"model_providers.{PROVIDER_ID}.wire_api=" + toml_string("responses"),
        f"model_providers.{PROVIDER_ID}.requires_openai_auth=false",
        f"model_providers.{PROVIDER_ID}.auth.command=" + toml_string(str(jq)),
        f"model_providers.{PROVIDER_ID}.auth.args="
        + toml_string_array(["-er", ".OPENAI_API_KEY", str(auth_file)]),
    )

    command = [str(profile_launcher), str(profile_source)]
    for override in overrides:
        command.extend(("-c", override))
    command.extend(codex_args)
    os.execvpe(str(profile_launcher), command, os.environ.copy())


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        print(f"codex-cliproxy-profile: {error}", file=sys.stderr)
        raise SystemExit(1)
