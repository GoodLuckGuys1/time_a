from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any
import httpx

from .config import Settings
from .duration import day_start_iso, format_duration, minutes_to_tracker_duration, parse_tracker_duration

try:
    from zoneinfo import ZoneInfo

    REPORT_TZ = ZoneInfo("Europe/Moscow")
except Exception:
    REPORT_TZ = timezone(timedelta(hours=3))


def today_report() -> date:
    return datetime.now(REPORT_TZ).date()


def _moscow_period_bounds(date_from: date, date_to: date) -> tuple[str, str]:
    """Интервал [from, to] по календарным дням в Europe/Moscow для фильтра createdAt."""
    start = f"{date_from.isoformat()}T00:00:00.000+0300"
    end_day = date_to + timedelta(days=1)
    end = f"{end_day.isoformat()}T00:00:00.000+0300"
    return start, end


class TrackerError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class TrackerClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _headers(self) -> dict[str, str]:
        token = self._settings.tracker_token
        auth = token if token.lower().startswith(("oauth ", "bearer ")) else f"OAuth {token}"
        return {
            "Authorization": auth,
            self._settings.org_header: self._settings.org_id,
            "Content-Type": "application/json",
        }

    async def _request(
        self,
        client: httpx.AsyncClient,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self._settings.tracker_base_url}{path}"
        response = await client.request(method, url, headers=self._headers(), params=params, json=json)
        if response.status_code >= 400:
            detail = response.text
            try:
                payload = response.json()
                detail = payload.get("errorMessages", payload) or detail
            except Exception:
                pass
            raise TrackerError(response.status_code, str(detail))
        if response.status_code == 204:
            return None
        return response.json()

    async def get_board(self, client: httpx.AsyncClient, board_id: int) -> dict[str, Any]:
        return await self._request(client, "GET", f"/v3/boards/{board_id}")

    async def get_myself(self, client: httpx.AsyncClient) -> dict[str, Any]:
        return await self._request(client, "GET", "/v3/myself")

    async def search_issues(
        self,
        client: httpx.AsyncClient,
        *,
        query: str | None = None,
        filter_body: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        body: dict[str, Any] = {}
        if query:
            body["query"] = query
        elif filter_body:
            body["filter"] = filter_body
        else:
            return []

        issues: list[dict[str, Any]] = []
        page = 1
        per_page = 100

        while True:
            params = {"perPage": per_page, "page": page}
            batch = await self._request(
                client,
                "POST",
                "/v3/issues/_search",
                params=params,
                json=body,
            )
            if not batch:
                break
            issues.extend(batch)
            if len(batch) < per_page:
                break
            page += 1
            if page > 100:
                break

        return issues

    async def get_board_issues(
        self,
        client: httpx.AsyncClient,
        board_id: int,
        board: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Задачи доски: filter/query доски + запасной поиск по ID доски."""
        seen: set[str] = set()
        merged: list[dict[str, Any]] = []

        def add_batch(batch: list[dict[str, Any]]) -> None:
            for issue in batch:
                key = issue.get("key")
                if key and key not in seen:
                    seen.add(key)
                    merged.append(issue)

        board_query = board.get("query")
        board_filter = board.get("filter")

        if board_query:
            add_batch(await self.search_issues(client, query=board_query))
        elif board_filter:
            add_batch(await self.search_issues(client, filter_body=board_filter))

        # Задачи в спринтах / на доске (если filter доски не вернул всё)
        add_batch(
            await self.search_issues(client, query=f'"Sprints By Board": {board_id}')
        )
        add_batch(
            await self.search_issues(
                client,
                query=f'"Sprint In Progress By Board": {board_id}',
            )
        )

        return merged

    async def get_issue_worklogs(
        self,
        client: httpx.AsyncClient,
        issue_key: str,
    ) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        last_id: int | str | None = None

        while True:
            params: dict[str, Any] = {"perPage": 500}
            if last_id is not None:
                params["id"] = last_id
            batch = await self._request(
                client,
                "GET",
                f"/v3/issues/{issue_key}/worklog",
                params=params,
            )
            if not batch:
                break
            entries.extend(batch)
            if len(batch) < 500:
                break
            last_id = batch[-1].get("id")

        return entries

    async def search_worklogs_global(
        self,
        client: httpx.AsyncClient,
        date_from: date,
        date_to: date,
        *,
        created_by: str | None,
    ) -> list[dict[str, Any]]:
        # Небольшой запас назад: списание могли создать позже дня работы
        search_from = date_from - timedelta(days=3)
        period_from, period_to = _moscow_period_bounds(search_from, date_to)

        bodies: list[dict[str, Any]] = []
        created_range = {"from": period_from, "to": period_to}
        if created_by:
            bodies.append({"createdBy": created_by, "createdAt": created_range})
        # Дублируем без createdBy — на случай несовпадения login/uid в API
        bodies.append({"createdAt": created_range})

        collected: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        for body in bodies:
            try:
                batch = await self._request(client, "POST", "/v3/worklog/_search", json=body) or []
            except TrackerError:
                continue
            for entry in batch:
                wid = _worklog_id(entry)
                if wid and wid not in seen_ids:
                    seen_ids.add(wid)
                    collected.append(entry)

        return collected

    async def collect_worklogs_for_issues(
        self,
        client: httpx.AsyncClient,
        issue_keys: list[str],
    ) -> list[dict[str, Any]]:
        sem = asyncio.Semaphore(12)

        async def one(key: str) -> list[dict[str, Any]]:
            async with sem:
                try:
                    return await self.get_issue_worklogs(client, key)
                except TrackerError:
                    return []

        chunks = await asyncio.gather(*(one(k) for k in issue_keys))
        merged: list[dict[str, Any]] = []
        seen: set[str] = set()
        for chunk in chunks:
            for entry in chunk:
                wid = _worklog_id(entry)
                if wid and wid not in seen:
                    seen.add(wid)
                    merged.append(entry)
        return merged

    async def fetch_time_report(
        self,
        board_id: int,
        date_from: date,
        date_to: date,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=120.0) as client:
            board = await self.get_board(client, board_id)
            issues = await self.get_board_issues(client, board_id, board)
            issue_keys = [issue["key"] for issue in issues if issue.get("key")]
            issue_titles = {
                issue["key"]: issue.get("summary") or issue.get("display", issue["key"])
                for issue in issues
                if issue.get("key")
            }

            myself = await self.get_myself(client)
            created_by = myself.get("login") or str(myself.get("uid", ""))

            from_issues = await self.collect_worklogs_for_issues(client, issue_keys)
            from_search = await self.search_worklogs_global(
                client,
                date_from,
                date_to,
                created_by=created_by or None,
            )

            worklogs = _merge_worklogs(from_issues, from_search)

        return aggregate_worklogs(
            worklogs=worklogs,
            issue_keys=set(issue_keys),
            issue_titles=issue_titles,
            board=board,
            date_from=date_from,
            date_to=date_to,
            stats={
                "issuesScanned": len(issue_keys),
                "worklogsFromIssues": len(from_issues),
                "worklogsFromSearch": len(from_search),
                "worklogsMerged": len(worklogs),
            },
        )

    async def update_worklog(
        self,
        issue_key: str,
        worklog_id: str | int,
        *,
        minutes: int,
        comment: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"duration": minutes_to_tracker_duration(minutes)}
        if comment is not None:
            body["comment"] = comment
        async with httpx.AsyncClient(timeout=60.0) as client:
            return await self._request(
                client,
                "PATCH",
                f"/v3/issues/{issue_key}/worklog/{worklog_id}",
                json=body,
            )

    async def delete_worklog(self, issue_key: str, worklog_id: str | int) -> None:
        async with httpx.AsyncClient(timeout=60.0) as client:
            await self._request(
                client,
                "DELETE",
                f"/v3/issues/{issue_key}/worklog/{worklog_id}",
            )

    async def check_write_scope(self) -> dict[str, Any]:
        """Проверяет, есть ли у текущего токена tracker:write (без изменения данных)."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"{self._settings.tracker_base_url}/v3/issues/__write_scope_probe__/worklog/0"
            response = await client.request(
                "PATCH",
                url,
                headers=self._headers(),
                json={"duration": "PT1M"},
            )
            text = response.text
            if response.status_code == 403 and "tracker:write" in text.lower():
                return {"ok": False, "message": "В токене нет права tracker:write"}
            if response.status_code in (403, 401):
                return {"ok": False, "message": text[:500] or f"HTTP {response.status_code}"}
            # 404/422 — запись не найдена, но право на запись есть
            return {"ok": True, "message": "Право tracker:write в токене есть"}

    async def create_worklog(
        self,
        issue_key: str,
        *,
        day: date,
        minutes: int,
        comment: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "start": day_start_iso(day),
            "duration": minutes_to_tracker_duration(minutes),
        }
        if comment:
            body["comment"] = comment
        async with httpx.AsyncClient(timeout=60.0) as client:
            return await self._request(
                client,
                "POST",
                f"/v3/issues/{issue_key}/worklog",
                json=body,
            )


def _issue_key(issue: dict[str, Any]) -> str | None:
    key = issue.get("key")
    if key:
        return str(key)
    display = issue.get("display") or ""
    if isinstance(display, str) and "-" in display:
        token = display.split()[0]
        if "-" in token:
            return token
    return None


def _worklog_id(entry: dict[str, Any]) -> str:
    issue = entry.get("issue") or {}
    key = _issue_key(issue) or ""
    return f"{key}:{entry.get('id')}"


def _merge_worklogs(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in groups:
        for entry in group:
            wid = _worklog_id(entry)
            if wid and wid not in seen:
                seen.add(wid)
                merged.append(entry)
    return merged


def _parse_tracker_datetime(raw: str) -> datetime | None:
    if not raw or not isinstance(raw, str):
        return None
    try:
        normalized = raw.strip().replace("Z", "+00:00")
        # Tracker часто отдаёт +0000 без двоеточия
        if len(normalized) >= 5 and normalized[-5] in "+-" and normalized[-3] != ":":
            normalized = f"{normalized[:-2]}:{normalized[-2:]}"
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _worklog_day(entry: dict[str, Any]) -> date | None:
    # День списания — по start (когда работали), не по createdAt
    raw = entry.get("start") or entry.get("createdAt")
    if not raw:
        return None
    dt = _parse_tracker_datetime(raw)
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(REPORT_TZ).date()


def aggregate_worklogs(
    *,
    worklogs: list[dict[str, Any]],
    issue_keys: set[str],
    issue_titles: dict[str, str],
    board: dict[str, Any],
    date_from: date,
    date_to: date,
    stats: dict[str, int] | None = None,
) -> dict[str, Any]:
    by_day: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"date": "", "totalMinutes": 0, "totalFormatted": "", "tasks": []}
    )
    task_index: dict[tuple[str, str], dict[str, Any]] = {}
    grand_total = timedelta(0)

    skipped_period = 0
    skipped_duration = 0

    for entry in worklogs:
        issue = entry.get("issue") or {}
        key = _issue_key(issue)
        if not key:
            continue
        day = _worklog_day(entry)
        if not day or day < date_from or day > date_to:
            skipped_period += 1
            continue

        duration = parse_tracker_duration(entry.get("duration", ""))
        if duration <= timedelta(0):
            skipped_duration += 1
            continue

        day_key = day.isoformat()
        day_bucket = by_day[day_key]
        day_bucket["date"] = day_key

        task_key = (day_key, key)
        if task_key not in task_index:
            task_row = {
                "issueKey": key,
                "issueTitle": issue_titles.get(key) or issue.get("display") or key,
                "issueUrl": f"https://tracker.yandex.ru/{key}",
                "minutes": 0,
                "formatted": "",
                "entries": [],
            }
            task_index[task_key] = task_row
            day_bucket["tasks"].append(task_row)

        task_row = task_index[task_key]
        minutes = int(duration.total_seconds() // 60)
        task_row["minutes"] += minutes
        day_bucket["totalMinutes"] += minutes
        grand_total += duration

        author = (entry.get("createdBy") or {}).get("display") or (entry.get("createdBy") or {}).get("id")
        task_row["entries"].append(
            {
                "id": entry.get("id"),
                "issueKey": key,
                "duration": entry.get("duration"),
                "minutes": minutes,
                "formatted": format_duration(duration),
                "comment": entry.get("comment") or "",
                "author": author or "",
                "start": entry.get("start"),
            }
        )

    days = []
    for day_key in sorted(by_day.keys(), reverse=True):
        bucket = by_day[day_key]
        bucket["totalFormatted"] = format_duration(timedelta(minutes=bucket["totalMinutes"]))
        bucket["tasks"].sort(key=lambda t: t["minutes"], reverse=True)
        for task in bucket["tasks"]:
            task["formatted"] = format_duration(timedelta(minutes=task["minutes"]))
        days.append(bucket)

    report_stats = dict(stats or {})
    report_stats.update(
        {
            "skippedOutOfPeriod": skipped_period,
            "skippedZeroDuration": skipped_duration,
            "worklogsInReport": sum(len(t["entries"]) for d in days for t in d["tasks"]),
        }
    )

    return {
        "board": {
            "id": board.get("id"),
            "name": board.get("name"),
            "url": f"https://tracker.yandex.ru/agile/board/{board.get('id')}",
            "issuesOnBoard": len(issue_keys),
        },
        "period": {"from": date_from.isoformat(), "to": date_to.isoformat()},
        "totalMinutes": int(grand_total.total_seconds() // 60),
        "totalFormatted": format_duration(grand_total),
        "days": days,
        "worklogCount": report_stats.get("worklogsInReport", 0),
        "stats": report_stats,
    }