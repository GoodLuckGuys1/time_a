from __future__ import annotations

import os
import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_ENV_PATH = _ROOT / ".env"
_EXAMPLE_PATH = _ROOT / ".env.example"

_ENV_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


def env_file_path() -> Path:
    if not _ENV_PATH.exists() and _EXAMPLE_PATH.exists():
        _ENV_PATH.write_text(_EXAMPLE_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    return _ENV_PATH


def read_env_values() -> dict[str, str]:
    path = env_file_path()
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = _ENV_KEY_RE.match(stripped)
        if not match:
            continue
        key, raw = match.group(1), match.group(2)
        values[key] = _unquote(raw.strip())
    return values


def apply_env_updates(updates: dict[str, str]) -> None:
    """Записывает ключи в .env, не трогая остальные строки и комментарии."""
    path = env_file_path()
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    pending = {k: v for k, v in updates.items() if v is not None}
    seen: set[str] = set()
    out: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            match = _ENV_KEY_RE.match(stripped)
            if match:
                key = match.group(1)
                if key in pending:
                    out.append(f"{key}={_quote(pending.pop(key))}")
                    seen.add(key)
                    continue
        out.append(line)

    for key, value in pending.items():
        out.append(f"{key}={_quote(value)}")
        seen.add(key)

    text = "\n".join(out).rstrip() + "\n"
    path.write_text(text, encoding="utf-8")

    for key, value in updates.items():
        if value is not None:
            os.environ[key] = value


def _quote(value: str) -> str:
    if not value:
        return ""
    if re.search(r'[\s#"\\]', value):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        inner = value[1:-1]
        return inner.replace('\\"', '"').replace("\\\\", "\\")
    return value
