from __future__ import annotations

import re

import httpx

from .config import Settings
from .errors import SCOPE_HINT

_ORG_RE = re.compile(
    r"(?:orgId|organizationId|cloudOrgId|org_id|x-org-id|x-cloud-org-id)"
    r'["\':\s]+([0-9a-f]{8,}|[0-9]{5,})',
    re.IGNORECASE,
)


async def test_org_access(settings: Settings, org_id: str, org_header: str) -> dict:
    """Проверяет пару токен + org_id запросом GET /v3/myself."""
    token = settings.tracker_token
    auth = token if token.lower().startswith(("oauth ", "bearer ")) else f"OAuth {token}"

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            f"{settings.tracker_base_url}/v3/myself",
            headers={
                "Authorization": auth,
                org_header: org_id,
            },
        )

    if response.status_code == 200:
        data = response.json()
        return {
            "ok": True,
            "login": data.get("login"),
            "display": data.get("display"),
            "orgId": org_id,
            "orgHeader": org_header,
        }

    detail: object = response.text
    try:
        detail = response.json()
    except Exception:
        pass

    hint = _error_hint(detail)
    return {
        "ok": False,
        "status": response.status_code,
        "orgId": org_id,
        "orgHeader": org_header,
        "detail": detail,
        "hint": hint,
    }


def _error_hint(detail: object) -> str | None:
    text = ""
    if isinstance(detail, dict):
        messages = detail.get("errorMessages") or []
        if isinstance(messages, list):
            text = " ".join(str(m) for m in messages)
        else:
            text = str(detail)
    else:
        text = str(detail)

    lower = text.lower()
    if "tracker:read" in lower and "scope" in lower:
        return SCOPE_HINT
    if response_status_org_mismatch(lower):
        return "Попробуйте другой TRACKER_ORG_ID или заголовок X-Cloud-Org-ID."
    return None


def response_status_org_mismatch(lower: str) -> bool:
    return "org" in lower and ("not found" in lower or "invalid" in lower)


async def probe_without_org(settings: Settings) -> dict:
    """Пробный запрос без org — подсказка в ответе API."""
    token = settings.tracker_token
    auth = token if token.lower().startswith(("oauth ", "bearer ")) else f"OAuth {token}"
    url = f"{settings.tracker_base_url}/v3/boards/{settings.board_id}"

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers={"Authorization": auth})

    return {
        "status": response.status_code,
        "body": response.text[:500],
    }


def extract_org_ids_from_text(text: str) -> list[str]:
    found: list[str] = []
    for match in _ORG_RE.finditer(text):
        value = match.group(1)
        if value not in found:
            found.append(value)
    return found


async def try_discover_org_ids(settings: Settings, candidates: list[str]) -> dict:
    """Перебирает кандидатов с обоими заголовками."""
    if not settings.tracker_token:
        return {"found": [], "message": "Нет OAuth-токена"}

    unique = []
    for c in candidates:
        c = c.strip()
        if c and c not in unique:
            unique.append(c)

    found = []
    for org_id in unique:
        for header in ("X-Org-ID", "X-Cloud-Org-ID"):
            result = await test_org_access(settings, org_id, header)
            if result.get("ok"):
                found.append(result)

    return {"found": found, "tried": len(unique)}
