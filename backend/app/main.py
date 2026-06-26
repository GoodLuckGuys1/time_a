from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .config import env_snapshot, settings
from .oauth_routes import router as oauth_router
from pydantic import BaseModel

from .errors import format_api_error
from .org_discovery import extract_org_ids_from_text, probe_without_org, test_org_access, try_discover_org_ids
from .tracker import TrackerClient, TrackerError, today_report

app = FastAPI(title="Yandex Tracker Time Analytics", version="1.0.0")
app.include_router(oauth_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = TrackerClient(settings)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
async def config_status() -> dict:
    cfg = env_snapshot()
    return {
        "configured": cfg.is_configured,
        "boardId": cfg.board_id,
        "orgHeader": cfg.org_header,
        "envPath": str(Path(__file__).resolve().parents[2] / ".env"),
        "hasToken": bool(cfg.tracker_token),
        "hasOrgId": bool(cfg.org_id),
        "hasClientId": bool(cfg.oauth_client_id),
        "hasClientSecret": bool(cfg.oauth_client_secret),
        "oauthStartUrl": "/oauth/start",
        "oauthRedirectUri": cfg.oauth_redirect_uri,
        "oauthScope": cfg.oauth_scope,
        "canEditWorklogs": cfg.is_configured,
        "oauthAppInfoUrl": (
            f"https://oauth.yandex.ru/client/{cfg.oauth_client_id}/info"
            if cfg.oauth_client_id
            else None
        ),
    }


@app.get("/api/check-write-access")
async def check_write_access() -> dict:
    if not settings.tracker_token:
        return {"ok": False, "message": "Нет TRACKER_OAUTH_TOKEN в .env"}
    if not settings.org_id:
        return {"ok": False, "message": "Нет TRACKER_ORG_ID в .env"}
    try:
        return await client.check_write_scope()
    except TrackerError as exc:
        detail = format_api_error(exc.message)
        if "tracker:write" in detail.lower():
            return {"ok": False, "message": detail}
        return {"ok": False, "message": detail}


@app.get("/api/test-org")
async def test_org(
    org_id: str = Query(..., min_length=1),
    org_header: str = Query("X-Org-ID"),
) -> dict:
    if not settings.tracker_token:
        raise HTTPException(status_code=503, detail="Сначала укажите TRACKER_OAUTH_TOKEN в .env")
    header = org_header if org_header in ("X-Org-ID", "X-Cloud-Org-ID") else "X-Org-ID"
    return await test_org_access(settings, org_id.strip(), header)


class DiscoverOrgBody(BaseModel):
    text: str = ""


@app.post("/api/discover-org")
async def discover_org(body: DiscoverOrgBody) -> dict:
    if not settings.tracker_token:
        raise HTTPException(status_code=503, detail="Сначала укажите TRACKER_OAUTH_TOKEN в .env")
    candidates = extract_org_ids_from_text(body.text)
    return await try_discover_org_ids(settings, candidates)


@app.get("/api/discover-org-hint")
async def discover_org_hint() -> dict:
    if not settings.tracker_token:
        return {"message": "Добавьте TRACKER_OAUTH_TOKEN в .env"}
    return await probe_without_org(settings)


@app.get("/oauth/org-help", response_class=HTMLResponse)
async def org_help() -> str:
    return """<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>Где взять ID организации</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
    code, pre { background: #f0f0f0; padding: 0.15rem 0.35rem; border-radius: 4px; }
    pre { padding: 1rem; overflow-x: auto; font-size: 0.85rem; }
    ol li { margin-bottom: 0.75rem; }
  </style>
</head>
<body>
  <h1>Где взять ID организации</h1>
  <p><strong>api.tracker</strong> в Сети часто нет — браузер ходит на <code>tracker.yandex.ru</code>, а не напрямую на API.</p>

  <h2>Способ 1 — консоль на странице Tracker (проще всего)</h2>
  <ol>
    <li>Откройте <a href="https://tracker.yandex.ru/agile/board/288">доску 288</a></li>
    <li><strong>F12</strong> → вкладка <strong>Консоль</strong></li>
    <li>Вставьте скрипт ниже и нажмите Enter — в консоли появятся возможные ID</li>
  </ol>
  <pre>(function () {
  const hits = new Set();
  const re = /(?:orgId|organizationId|cloudOrgId|org_id|x-org-id|x-cloud-org-id)["':\\s]+([0-9a-f]{8,}|[0-9]{5,})/gi;
  const scan = (s) => { let m; while ((m = re.exec(s || ''))) hits.add(m[1]); };
  scan(document.documentElement.innerHTML);
  for (const k of Object.keys(localStorage)) scan(localStorage.getItem(k));
  for (const k of Object.keys(sessionStorage)) scan(sessionStorage.getItem(k));
  console.log('Возможные Org ID:', [...hits]);
  return [...hits];
})();</pre>
  <p>Скопируйте число → проверьте на главной странице приложения кнопкой «Проверить».</p>

  <h2>Способ 2 — вкладка «Приложение» (Application)</h2>
  <ol>
    <li>F12 → <strong>Приложение</strong> → <strong>Локальное хранилище</strong> → <code>https://tracker.yandex.ru</code></li>
    <li>В поиске по ключам введите <code>org</code> — ищите значения с цифрами</li>
  </ol>

  <h2>Способ 3 — Сеть (другой фильтр)</h2>
  <ol>
    <li>F12 → <strong>Сеть</strong> → тип <strong>Fetch/XHR</strong></li>
    <li>Фильтр: <code>tracker</code> или <code>288</code> или <code>gateway</code> (не api.tracker)</li>
    <li>Откройте запрос → <strong>Заголовки</strong> → ищите <code>x-org-id</code> / <code>x-cloud-org-id</code></li>
  </ol>

  <h2>Yandex Cloud</h2>
  <p>ID организации: <a href="https://console.cloud.yandex.ru/" target="_blank">console.cloud.yandex.ru</a> → организация → скопировать ID. В .env: <code>TRACKER_ORG_HEADER=X-Cloud-Org-ID</code></p>
</body>
</html>"""


@app.get("/api/assignee-worklogs")
async def assignee_worklogs(
    date_from: Optional[date] = Query(None, alias="from"),
    date_to: Optional[date] = Query(None, alias="to"),
    board_id: Optional[int] = Query(None),
    assignee: Optional[str] = Query(None, description="login или id автора списания"),
) -> dict:
    if not settings.is_configured:
        raise HTTPException(
            status_code=503,
            detail="Задайте TRACKER_OAUTH_TOKEN и TRACKER_ORG_ID в файле .env",
        )

    today = today_report()
    end = date_to or today
    start = date_from or (end - timedelta(days=30))
    if start > end:
        raise HTTPException(status_code=400, detail="Дата «с» не может быть позже даты «по»")

    target_board = board_id or settings.board_id
    try:
        return await client.fetch_assignee_worklog_report(
            target_board,
            start,
            end,
            assignee_key=assignee.strip() if assignee else None,
        )
    except TrackerError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=format_api_error(exc.message),
        ) from exc


@app.get("/api/sprint-load")
async def sprint_load(board_id: Optional[int] = Query(None)) -> dict:
    if not settings.is_configured:
        raise HTTPException(
            status_code=503,
            detail="Задайте TRACKER_OAUTH_TOKEN и TRACKER_ORG_ID в файле .env",
        )

    target_board = board_id or settings.board_id
    try:
        return await client.fetch_sprint_load_report(target_board)
    except TrackerError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=format_api_error(exc.message),
        ) from exc


@app.get("/api/time-report")
async def time_report(
    date_from: Optional[date] = Query(None, alias="from"),
    date_to: Optional[date] = Query(None, alias="to"),
    board_id: Optional[int] = Query(None),
) -> dict:
    if not settings.is_configured:
        raise HTTPException(
            status_code=503,
            detail="Задайте TRACKER_OAUTH_TOKEN и TRACKER_ORG_ID в файле .env",
        )

    today = today_report()
    end = date_to or today
    start = date_from or (end - timedelta(days=30))
    if start > end:
        raise HTTPException(status_code=400, detail="Дата «с» не может быть позже даты «по»")

    target_board = board_id or settings.board_id

    try:
        return await client.fetch_time_report(target_board, start, end)
    except TrackerError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=format_api_error(exc.message),
        ) from exc


class WorklogUpdateBody(BaseModel):
    minutes: int
    comment: Optional[str] = None
    day: Optional[date] = None


class WorklogCreateBody(BaseModel):
    day: date
    minutes: int
    comment: Optional[str] = None


def _require_configured() -> None:
    if not settings.is_configured:
        raise HTTPException(
            status_code=503,
            detail="Задайте TRACKER_OAUTH_TOKEN и TRACKER_ORG_ID в файле .env",
        )


def _tracker_http_error(exc: TrackerError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=format_api_error(exc.message))


@app.patch("/api/issues/{issue_key}/worklog/{worklog_id}")
async def patch_worklog(
    issue_key: str,
    worklog_id: str,
    body: WorklogUpdateBody,
) -> dict:
    _require_configured()
    if body.minutes < 0:
        raise HTTPException(status_code=400, detail="Длительность не может быть отрицательной")
    if body.minutes == 0:
        raise HTTPException(status_code=400, detail="Укажите длительность больше 0 или удалите запись")
    try:
        return await client.update_worklog(
            issue_key,
            worklog_id,
            minutes=body.minutes,
            comment=body.comment,
            day=body.day,
        )
    except TrackerError as exc:
        raise _tracker_http_error(exc) from exc


@app.delete("/api/issues/{issue_key}/worklog/{worklog_id}", status_code=204)
async def remove_worklog(issue_key: str, worklog_id: str) -> None:
    _require_configured()
    try:
        await client.delete_worklog(issue_key, worklog_id)
    except TrackerError as exc:
        raise _tracker_http_error(exc) from exc


@app.post("/api/issues/{issue_key}/worklog", status_code=201)
async def add_worklog(issue_key: str, body: WorklogCreateBody) -> dict:
    _require_configured()
    if body.minutes <= 0:
        raise HTTPException(status_code=400, detail="Длительность должна быть больше 0")
    try:
        return await client.create_worklog(
            issue_key,
            day=body.day,
            minutes=body.minutes,
            comment=body.comment,
        )
    except TrackerError as exc:
        raise _tracker_http_error(exc) from exc


dist_dir = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="static")
