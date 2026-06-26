from __future__ import annotations

import asyncio
import random
import re
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, NamedTuple
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


class BoardWorklogs(NamedTuple):
    all: list[dict[str, Any]]
    mine: list[dict[str, Any]]


class TrackerError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


_NO_SPRINTS_MARKERS = (
    "не может быть спринтов",
    "cannot have sprints",
)


def _is_no_sprints_board_error(exc: TrackerError) -> bool:
    text = str(exc.message).lower()
    return any(marker in text for marker in _NO_SPRINTS_MARKERS)


_RETRYABLE_STATUS = frozenset({429, 502, 503, 504})
_MAX_REQUEST_RETRIES = 5
_WORKLOG_CACHE_TTL_SEC = 300
_BOARD_ISSUES_CACHE_TTL_SEC = 300
_SPRINT_LOAD_CACHE_TTL_SEC = 300
_ORG_USERS_CACHE_TTL_SEC = 3600
_WORKLOG_SEARCH_CAP = 50
_MAX_PER_USER_WORKLOG_FETCHES = 120
_ENRICH_KEYS_CHUNK = 50
_ENRICH_PARALLEL_BATCHES = 4
_board_worklog_cache: dict[tuple, tuple[float, BoardWorklogs]] = {}
_board_issues_cache: dict[tuple[int, str, bool], tuple[float, list[dict[str, Any]]]] = {}
_sprint_load_cache: dict[tuple[int, str], tuple[float, dict[str, Any]]] = {}
_org_user_logins_cache: tuple[float, list[str]] | None = None
_tracker_cache_lock = asyncio.Lock()


def invalidate_board_worklog_cache() -> None:
    """Сброс кэша списаний после create/update/delete."""
    _board_worklog_cache.clear()


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
        last_network_error: Exception | None = None

        for attempt in range(_MAX_REQUEST_RETRIES):
            try:
                response = await client.request(
                    method, url, headers=self._headers(), params=params, json=json
                )
            except (httpx.ReadError, httpx.ConnectError, httpx.WriteError, httpx.TimeoutException) as exc:
                last_network_error = exc
                if attempt >= _MAX_REQUEST_RETRIES - 1:
                    break
                await asyncio.sleep(min(2**attempt + random.random() * 0.5, 20))
                continue

            if response.status_code in _RETRYABLE_STATUS and attempt < _MAX_REQUEST_RETRIES - 1:
                await asyncio.sleep(min(2**attempt + random.random() * 0.5, 30))
                continue

            if response.status_code >= 400:
                detail = response.text
                try:
                    payload = response.json()
                    detail = payload.get("errorMessages", payload) or detail
                except Exception:
                    pass
                if response.status_code == 429:
                    detail = (
                        f"{detail}. Слишком много запросов к Tracker — "
                        "подождите минуту и обновите страницу."
                    )
                raise TrackerError(response.status_code, str(detail))
            if response.status_code == 204:
                return None
            return response.json()

        if last_network_error:
            raise TrackerError(503, f"Ошибка сети при обращении к Tracker: {last_network_error}") from last_network_error
        raise TrackerError(503, "Не удалось получить ответ от Tracker")

    async def get_board(self, client: httpx.AsyncClient, board_id: int) -> dict[str, Any]:
        return await self._request(client, "GET", f"/v3/boards/{board_id}")

    async def get_board_sprints(
        self,
        client: httpx.AsyncClient,
        board_id: int,
    ) -> list[dict[str, Any]]:
        try:
            result = await self._request(client, "GET", f"/v3/boards/{board_id}/sprints")
            return result if isinstance(result, list) else []
        except TrackerError as exc:
            if _is_no_sprints_board_error(exc):
                return []
            raise

    async def get_sprint(
        self,
        client: httpx.AsyncClient,
        sprint_id: str | int,
    ) -> dict[str, Any] | None:
        try:
            result = await self._request(client, "GET", f"/v3/sprints/{sprint_id}")
            return result if isinstance(result, dict) else None
        except TrackerError:
            return None

    async def build_sprint_periods_map(
        self,
        client: httpx.AsyncClient,
        board_id: int,
        sprint_ids: set[str],
    ) -> dict[str, tuple[date, date]]:
        periods: dict[str, tuple[date, date]] = {}
        for sprint in await self.get_board_sprints(client, board_id):
            sid = sprint.get("id")
            if sid is None:
                continue
            sid_s = str(sid)
            if sprint_ids and sid_s not in sprint_ids:
                continue
            period = _sprint_period_from_api(sprint)
            if period:
                periods[sid_s] = period

        for sid in sprint_ids:
            if sid in periods:
                continue
            full = await self.get_sprint(client, sid)
            if full:
                period = _sprint_period_from_api(full)
                if period:
                    periods[sid] = period
        return periods

    async def get_myself(self, client: httpx.AsyncClient) -> dict[str, Any]:
        return await self._request(client, "GET", "/v3/myself")

    async def get_issue(
        self,
        client: httpx.AsyncClient,
        issue_key: str,
        *,
        fields: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if fields:
            params["fields"] = fields
        return await self._request(client, "GET", f"/v3/issues/{issue_key}", params=params or None)

    async def search_issues(
        self,
        client: httpx.AsyncClient,
        *,
        query: str | None = None,
        filter_body: dict[str, Any] | None = None,
        fields: str | None = None,
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
            params: dict[str, Any] = {"perPage": per_page, "page": page}
            if fields:
                params["fields"] = fields
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

    async def _search_issues_safe(
        self,
        client: httpx.AsyncClient,
        *,
        query: str,
        fields: str | None = None,
    ) -> list[dict[str, Any]]:
        try:
            return await self.search_issues(client, query=query, fields=fields)
        except TrackerError as exc:
            if _is_no_sprints_board_error(exc):
                return []
            raise

    def _issue_needs_agile_enrich(self, issue: dict[str, Any]) -> bool:
        if not issue.get("key"):
            return False
        if "sprint" not in issue:
            return True
        if "originalEstimation" not in issue and "estimation" not in issue:
            return True
        return False

    @staticmethod
    def _merge_agile_issue_fields(row: dict[str, Any], full: dict[str, Any]) -> None:
        if full.get("sprint") is not None:
            row["sprint"] = full["sprint"]
        for name in (
            "assignee",
            "originalEstimation",
            "estimation",
            "spent",
            "summary",
            "status",
        ):
            if name in full:
                row[name] = full[name]

    async def enrich_issues_agile_fields(
        self,
        client: httpx.AsyncClient,
        issues: list[dict[str, Any]],
        *,
        fields: str,
    ) -> None:
        """Дополняет sprint и оценки пакетным поиском по keys (без сотен GET /issues/{key})."""
        key_index = {issue["key"]: issue for issue in issues if issue.get("key")}
        need_keys = [key for key, issue in key_index.items() if self._issue_needs_agile_enrich(issue)]
        if not need_keys:
            return

        sem = asyncio.Semaphore(_ENRICH_PARALLEL_BATCHES)

        async def fetch_chunk(chunk: list[str]) -> None:
            async with sem:
                try:
                    batch = await self.search_issues(
                        client,
                        filter_body={"keys": chunk},
                        fields=fields,
                    )
                except TrackerError:
                    return
                for full in batch:
                    key = full.get("key")
                    if not key:
                        continue
                    row = key_index.get(key)
                    if row:
                        self._merge_agile_issue_fields(row, full)

        chunks = [
            need_keys[i : i + _ENRICH_KEYS_CHUNK]
            for i in range(0, len(need_keys), _ENRICH_KEYS_CHUNK)
        ]
        await asyncio.gather(*(fetch_chunk(chunk) for chunk in chunks))

    async def get_board_issues(
        self,
        client: httpx.AsyncClient,
        board_id: int,
        board: dict[str, Any],
        *,
        include_sprint_queries: bool = True,
        fields: str | None = None,
        use_cache: bool = True,
    ) -> list[dict[str, Any]]:
        """Задачи доски: filter/query доски + опционально поиск по спринтам."""
        fields_key = fields or ""
        cache_key = (board_id, fields_key, include_sprint_queries)
        now = time.monotonic()
        if use_cache:
            async with _tracker_cache_lock:
                cached = _board_issues_cache.get(cache_key)
                if cached and now - cached[0] < _BOARD_ISSUES_CACHE_TTL_SEC:
                    return cached[1]

        seen: set[str] = set()
        merged: list[dict[str, Any]] = []

        def add_batch(batch: list[dict[str, Any]] | BaseException) -> None:
            if isinstance(batch, BaseException):
                return
            for issue in batch:
                key = issue.get("key")
                if key and key not in seen:
                    seen.add(key)
                    merged.append(issue)

        board_query = board.get("query")
        board_filter = board.get("filter")

        async def boards_search() -> list[dict[str, Any]]:
            try:
                return await self.search_issues(
                    client,
                    query=f'"Boards": {board_id}',
                    fields=fields,
                )
            except TrackerError:
                return []

        coros: list[Any] = [boards_search()]
        if board_query:
            coros.insert(0, self.search_issues(client, query=board_query, fields=fields))
        elif board_filter:
            coros.insert(0, self.search_issues(client, filter_body=board_filter, fields=fields))

        if include_sprint_queries:
            coros.append(
                self._search_issues_safe(
                    client,
                    query=f'"Sprints By Board": {board_id}',
                    fields=fields,
                )
            )
            coros.append(
                self._search_issues_safe(
                    client,
                    query=f'"Sprint In Progress By Board": {board_id}',
                    fields=fields,
                )
            )

        for batch in await asyncio.gather(*coros, return_exceptions=True):
            add_batch(batch)

        if use_cache:
            async with _tracker_cache_lock:
                _board_issues_cache[cache_key] = (now, merged)
        return merged

    async def get_sprint_report_issues(
        self,
        client: httpx.AsyncClient,
        board_id: int,
        board: dict[str, Any],
        *,
        fields: str,
    ) -> list[dict[str, Any]]:
        """Все задачи спринтов доски, включая закрытые (не только открытые на колонках)."""
        seen: set[str] = set()
        merged: list[dict[str, Any]] = []

        def add_batch(batch: list[dict[str, Any]] | BaseException) -> None:
            if isinstance(batch, BaseException):
                return
            for issue in batch:
                key = issue.get("key")
                if key and key not in seen:
                    seen.add(key)
                    merged.append(issue)

        # Не используем board.query/filter — на доске часто только открытые задачи.
        seed_coros: list[Any] = [
            self.search_issues(client, query=f'"Boards": {board_id}', fields=fields),
            self._search_issues_safe(
                client,
                query=f'"Sprints By Board": {board_id}',
                fields=fields,
            ),
            self._search_issues_safe(
                client,
                query=f'"Sprint In Progress By Board": {board_id}',
                fields=fields,
            ),
        ]
        for batch in await asyncio.gather(*seed_coros, return_exceptions=True):
            add_batch(batch)

        await self.enrich_issues_agile_fields(client, merged, fields=fields)

        sprint_targets: dict[str, str] = {}
        for issue in merged:
            for _group_key, label, sprint_id, _url in _agile_sprint_groups_for_issue(
                issue,
                board_id=board_id,
                name_prefix="",
            ):
                if sprint_id:
                    sprint_targets.setdefault(str(sprint_id), label)

        for sprint in await self.get_board_sprints(client, board_id):
            sprint_id = sprint.get("id")
            if sprint_id is None:
                continue
            sid = str(sprint_id)
            label = str(sprint.get("name") or sprint.get("display") or sid)
            sprint_targets.setdefault(sid, label)

        sem = asyncio.Semaphore(4)

        async def fetch_sprint_issues(sprint_id: str, label: str) -> None:
            async with sem:
                by_id = await self._search_issues_safe(
                    client,
                    query=f"Sprint: {sprint_id}",
                    fields=fields,
                )
                add_batch(by_id)
                if label and label != sprint_id:
                    by_name = await self._search_issues_safe(
                        client,
                        query=f'Sprint: "{label}"',
                        fields=fields,
                    )
                    add_batch(by_name)

        if sprint_targets:
            await asyncio.gather(
                *(fetch_sprint_issues(sid, label) for sid, label in sprint_targets.items())
            )
            await self.enrich_issues_agile_fields(client, merged, fields=fields)

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

    async def _search_worklogs_range(
        self,
        client: httpx.AsyncClient,
        range_from: date,
        range_to: date,
        *,
        created_by: str | None,
    ) -> list[dict[str, Any]]:
        """Поиск списаний за интервал; при лимите ~50 записей делит период пополам."""
        if range_from > range_to:
            return []

        period_from, period_to = _moscow_period_bounds(range_from, range_to)
        body: dict[str, Any] = {"createdAt": {"from": period_from, "to": period_to}}
        if created_by:
            body["createdBy"] = created_by

        try:
            batch = await self._request(client, "POST", "/v3/worklog/_search", json=body) or []
        except TrackerError:
            batch = []

        if len(batch) < _WORKLOG_SEARCH_CAP or range_from >= range_to:
            return batch

        days_span = (range_to - range_from).days
        if days_span <= 0:
            return batch

        mid = range_from + timedelta(days=days_span // 2)
        left = await self._search_worklogs_range(
            client, range_from, mid, created_by=created_by
        )
        right = await self._search_worklogs_range(
            client, mid + timedelta(days=1), range_to, created_by=created_by
        )
        return _merge_worklogs(left, right)

    async def search_worklogs_global(
        self,
        client: httpx.AsyncClient,
        date_from: date,
        date_to: date,
        *,
        created_by: str | None,
    ) -> list[dict[str, Any]]:
        """Поиск списаний за период (Tracker отдаёт ~50 записей за запрос без деления)."""
        if created_by:
            return await self._search_worklogs_range(
                client, date_from, date_to, created_by=created_by
            )

        search_from = date_from - timedelta(days=3)
        collected: list[dict[str, Any]] = []
        cursor = search_from
        while cursor <= date_to:
            batch = await self._search_worklogs_range(
                client, cursor, cursor, created_by=None
            )
            collected = _merge_worklogs(collected, batch)
            cursor += timedelta(days=1)
        return collected

    async def get_org_user_logins(self, client: httpx.AsyncClient) -> list[str]:
        global _org_user_logins_cache
        now = time.monotonic()
        async with _tracker_cache_lock:
            if (
                _org_user_logins_cache
                and now - _org_user_logins_cache[0] < _ORG_USERS_CACHE_TTL_SEC
            ):
                return _org_user_logins_cache[1]

        logins: list[str] = []
        page = 1
        try:
            while page <= 50:
                batch = await self._request(
                    client,
                    "GET",
                    "/v3/users",
                    params={"perPage": 100, "page": page},
                )
                if not isinstance(batch, list) or not batch:
                    break
                for user in batch:
                    login = user.get("login")
                    if login:
                        logins.append(str(login))
                if len(batch) < 100:
                    break
                page += 1
        except TrackerError:
            logins = []

        async with _tracker_cache_lock:
            _org_user_logins_cache = (now, logins)
        return logins

    @staticmethod
    def _collect_assignee_logins(issues: list[dict[str, Any]]) -> set[str]:
        logins: set[str] = set()
        for issue in issues:
            assignee = issue.get("assignee") or {}
            login = assignee.get("login")
            if login:
                logins.add(str(login))
        return logins

    async def _worklog_logins_to_fetch(
        self,
        client: httpx.AsyncClient,
        issues: list[dict[str, Any]],
        *,
        user_login: str | None,
    ) -> set[str]:
        logins = self._collect_assignee_logins(issues)
        logins.update(self._settings.extra_worklog_logins)
        if user_login:
            logins.add(str(user_login))

        org_logins = await self.get_org_user_logins(client)
        if len(org_logins) <= _MAX_PER_USER_WORKLOG_FETCHES:
            logins.update(org_logins)
        return logins

    async def fetch_board_worklogs(
        self,
        client: httpx.AsyncClient,
        board_id: int,
        date_from: date,
        date_to: date,
        issue_keys: set[str],
        *,
        user_login: str | None = None,
        issues: list[dict[str, Any]] | None = None,
    ) -> BoardWorklogs:
        """Списания по задачам доски: по каждому сотруднику + общий поиск (лимит API ~50)."""
        cache_key = (board_id, date_from.isoformat(), date_to.isoformat(), user_login or "", "v4")
        now = time.monotonic()

        async with _tracker_cache_lock:
            cached = _board_worklog_cache.get(cache_key)
            if cached and now - cached[0] < _WORKLOG_CACHE_TTL_SEC:
                return cached[1]

        board_issues = issues or []
        logins = await self._worklog_logins_to_fetch(
            client, board_issues, user_login=user_login
        )

        sem = asyncio.Semaphore(10)

        async def fetch_login(login: str) -> list[dict[str, Any]]:
            async with sem:
                try:
                    return await self.search_worklogs_global(
                        client, date_from, date_to, created_by=login
                    )
                except TrackerError:
                    return []

        per_user_groups = await asyncio.gather(*(fetch_login(login) for login in sorted(logins)))
        global_wl = await self.search_worklogs_global(
            client, date_from, date_to, created_by=None
        )
        raw = _merge_worklogs(global_wl, *per_user_groups)

        user_wl: list[dict[str, Any]] = []
        if user_login:
            user_wl = await self.search_worklogs_global(
                client, date_from, date_to, created_by=user_login
            )
            raw = _merge_worklogs(raw, user_wl)

        def filter_board(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
            out: list[dict[str, Any]] = []
            for entry in entries:
                key = _issue_key(entry.get("issue") or {})
                if key and key in issue_keys:
                    out.append(entry)
            return out

        filtered_all = filter_board(raw)
        filtered_mine = filter_board(user_wl) if user_login else filtered_all
        result = BoardWorklogs(filtered_all, filtered_mine)

        async with _tracker_cache_lock:
            _board_worklog_cache[cache_key] = (now, result)

        return result

    async def collect_worklogs_for_issues(
        self,
        client: httpx.AsyncClient,
        issue_keys: list[str],
    ) -> list[dict[str, Any]]:
        """Запасной вариант для небольших досок (иначе — fetch_board_worklogs)."""
        if len(issue_keys) > 80:
            return []

        sem = asyncio.Semaphore(4)

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

    async def fetch_sprint_load_report(self, board_id: int) -> dict[str, Any]:
        cache_key = (board_id, "v3-sprint-spent-period")
        now = time.monotonic()
        async with _tracker_cache_lock:
            cached = _sprint_load_cache.get(cache_key)
            if cached and now - cached[0] < _SPRINT_LOAD_CACHE_TTL_SEC:
                return cached[1]

        sprint_fields = "sprint,assignee,originalEstimation,estimation,summary,status"
        name_prefix = self._settings.sprint_tag_prefix
        async with httpx.AsyncClient(timeout=180.0) as client:
            board = await self.get_board(client, board_id)
            issues = await self.get_sprint_report_issues(
                client,
                board_id,
                board,
                fields=sprint_fields,
            )
            sprint_ids: set[str] = set()
            for issue in issues:
                for _gk, _label, sprint_id, _url in _agile_sprint_groups_for_issue(
                    issue,
                    board_id=board_id,
                    name_prefix=name_prefix,
                ):
                    if sprint_id:
                        sprint_ids.add(str(sprint_id))

            sprint_periods = await self.build_sprint_periods_map(
                client, board_id, sprint_ids
            )
            worklogs: list[dict[str, Any]] = []
            if sprint_periods:
                issue_key_set = {issue["key"] for issue in issues if issue.get("key")}
                period_from = min(period[0] for period in sprint_periods.values())
                period_to = max(period[1] for period in sprint_periods.values())
                board_worklogs = await self.fetch_board_worklogs(
                    client,
                    board_id,
                    period_from,
                    period_to,
                    issue_key_set,
                    issues=issues,
                )
                worklogs = board_worklogs.all

            result = _aggregate_sprint_load_by_agile(
                issues=issues,
                board=board,
                board_id=board_id,
                name_prefix=name_prefix,
                worklogs=worklogs,
                sprint_periods=sprint_periods,
            )

        async with _tracker_cache_lock:
            _sprint_load_cache[cache_key] = (now, result)
        return result

    async def fetch_assignee_worklog_report(
        self,
        board_id: int,
        date_from: date,
        date_to: date,
        assignee_key: str | None = None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=120.0) as client:
            board, myself = await asyncio.gather(
                self.get_board(client, board_id),
                self.get_myself(client),
            )
            issues = await self.get_board_issues(
                client,
                board_id,
                board,
                include_sprint_queries=False,
            )
            issue_keys = [issue["key"] for issue in issues if issue.get("key")]
            issue_titles = {
                issue["key"]: issue.get("summary") or issue.get("display", issue["key"])
                for issue in issues
                if issue.get("key")
            }
            issue_key_set = set(issue_keys)
            board_worklogs = await self.fetch_board_worklogs(
                client,
                board_id,
                date_from,
                date_to,
                issue_key_set,
                user_login=myself.get("login"),
                issues=issues,
            )

        return aggregate_assignee_worklogs(
            worklogs=board_worklogs.all,
            issue_keys=issue_key_set,
            issue_titles=issue_titles,
            board=board,
            date_from=date_from,
            date_to=date_to,
            assignee_key=assignee_key,
            current_user=myself,
        )

    async def fetch_time_report(
        self,
        board_id: int,
        date_from: date,
        date_to: date,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=120.0) as client:
            board, myself = await asyncio.gather(
                self.get_board(client, board_id),
                self.get_myself(client),
            )
            issues = await self.get_board_issues(client, board_id, board)
            issue_keys = [issue["key"] for issue in issues if issue.get("key")]
            issue_titles = {
                issue["key"]: issue.get("summary") or issue.get("display", issue["key"])
                for issue in issues
                if issue.get("key")
            }

            issue_key_set = set(issue_keys)
            board_worklogs = await self.fetch_board_worklogs(
                client,
                board_id,
                date_from,
                date_to,
                issue_key_set,
                user_login=myself.get("login"),
                issues=issues,
            )

        stats = {
            "issuesScanned": len(issue_keys),
            "worklogsInReport": len(board_worklogs.all),
            "myWorklogsInReport": len(board_worklogs.mine),
        }
        report = aggregate_worklogs(
            worklogs=board_worklogs.all,
            issue_keys=issue_key_set,
            issue_titles=issue_titles,
            board=board,
            date_from=date_from,
            date_to=date_to,
            current_user=myself,
            stats=stats,
        )
        my_report = aggregate_worklogs(
            worklogs=board_worklogs.mine,
            issue_keys=issue_key_set,
            issue_titles=issue_titles,
            board=board,
            date_from=date_from,
            date_to=date_to,
            current_user=myself,
        )
        report["myDays"] = my_report["days"]
        report["myTotalMinutes"] = my_report["totalMinutes"]
        report["myTotalFormatted"] = my_report["totalFormatted"]
        return report

    async def update_worklog(
        self,
        issue_key: str,
        worklog_id: str | int,
        *,
        minutes: int,
        comment: str | None = None,
        day: date | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"duration": minutes_to_tracker_duration(minutes)}
        if comment is not None:
            body["comment"] = comment
        if day is not None:
            body["start"] = day_start_iso(day)

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                result = await self._request(
                    client,
                    "PATCH",
                    f"/v3/issues/{issue_key}/worklog/{worklog_id}",
                    json=body,
                )
            except TrackerError as exc:
                if day is None or exc.status_code not in (400, 422):
                    raise
                await self._request(
                    client,
                    "DELETE",
                    f"/v3/issues/{issue_key}/worklog/{worklog_id}",
                )
                result = await self._request(
                    client,
                    "POST",
                    f"/v3/issues/{issue_key}/worklog",
                    json={
                        "start": day_start_iso(day),
                        "duration": minutes_to_tracker_duration(minutes),
                        **({"comment": comment} if comment else {}),
                    },
                )
        invalidate_board_worklog_cache()
        return result

    async def delete_worklog(self, issue_key: str, worklog_id: str | int) -> None:
        async with httpx.AsyncClient(timeout=60.0) as client:
            await self._request(
                client,
                "DELETE",
                f"/v3/issues/{issue_key}/worklog/{worklog_id}",
            )
        invalidate_board_worklog_cache()

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
            result = await self._request(
                client,
                "POST",
                f"/v3/issues/{issue_key}/worklog",
                json=body,
            )
        invalidate_board_worklog_cache()
        return result


def _board_summary(board: dict[str, Any]) -> dict[str, Any]:
    board_id = board.get("id")
    return {
        "id": board_id,
        "name": board.get("name"),
        "url": f"https://tracker.yandex.ru/agile/board/{board_id}",
    }


def _assignee_label(issue: dict[str, Any]) -> tuple[str, str]:
    assignee = issue.get("assignee") or {}
    if not assignee:
        return ("__unassigned__", "Без исполнителя")
    assignee_id = str(assignee.get("id") or assignee.get("login") or assignee.get("display") or "__unknown__")
    name = assignee.get("display") or assignee.get("login") or assignee_id
    return (assignee_id, str(name))


def _parse_duration_value(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        ms = int(value)
        if ms <= 0:
            return 0
        return ms // 60_000
    if isinstance(value, str) and value.strip():
        duration = parse_tracker_duration(value)
        return int(duration.total_seconds() // 60)
    return 0


def _issue_original_estimation_minutes(issue: dict[str, Any]) -> int:
    return _parse_duration_value(issue.get("originalEstimation"))


def _issue_estimation_minutes(issue: dict[str, Any]) -> int:
    return _parse_duration_value(issue.get("estimation"))


def _parse_sprint_calendar_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, str) and value.strip():
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError:
            dt = _parse_tracker_datetime(value)
            return dt.date() if dt else None
    return None


def _sprint_period_from_api(sprint: dict[str, Any]) -> tuple[date, date] | None:
    start = _parse_sprint_calendar_date(sprint.get("startDate"))
    end = _parse_sprint_calendar_date(sprint.get("endDate"))
    if not start:
        start_dt = _parse_tracker_datetime(str(sprint.get("startDateTime") or ""))
        start = start_dt.date() if start_dt else None
    if not end:
        end_dt = _parse_tracker_datetime(str(sprint.get("endDateTime") or ""))
        end = end_dt.date() if end_dt else None
    if start and end and start <= end:
        return start, end
    return None


def _worklog_minutes_for_issue(
    worklogs: list[dict[str, Any]],
    issue_key: str,
    date_from: date,
    date_to: date,
) -> int:
    total = 0
    for entry in worklogs:
        if _issue_key(entry.get("issue") or {}) != issue_key:
            continue
        day = _worklog_day(entry)
        if not day or day < date_from or day > date_to:
            continue
        duration = parse_tracker_duration(entry.get("duration", ""))
        if duration > timedelta(0):
            total += int(duration.total_seconds() // 60)
    return total


def _agile_sprint_groups_for_issue(
    issue: dict[str, Any],
    *,
    board_id: int,
    name_prefix: str,
) -> list[tuple[str, str, str | None, str | None]]:
    """Спринты из поля issue.sprint (вкладка Agile). (group_key, label, sprint_id, url)."""
    raw = issue.get("sprint")
    if not raw or not isinstance(raw, list):
        return []

    groups: list[tuple[str, str, str | None, str | None]] = []
    seen: set[str] = set()

    for item in raw:
        sprint_id: str | None = None
        label: str | None = None
        if isinstance(item, dict):
            sprint_id = str(item["id"]) if item.get("id") is not None else None
            label = item.get("display") or item.get("name")
            if label:
                label = str(label).strip()
        elif isinstance(item, (str, int)):
            sprint_id = str(item)
            label = sprint_id

        if not label:
            continue
        if name_prefix and not label.lower().startswith(name_prefix.lower()):
            continue

        group_key = f"sprint:{sprint_id}" if sprint_id else f"name:{label}"
        if group_key in seen:
            continue
        seen.add(group_key)

        url = (
            f"https://tracker.yandex.ru/agile/board/{board_id}/sprint/{sprint_id}"
            if sprint_id and board_id
            else None
        )
        groups.append((group_key, label, sprint_id, url))

    return groups


def _sprint_group_sort_key(group_key: str, label: str, sprint_id: str | None) -> tuple[int, int | str]:
    if sprint_id and str(sprint_id).isdigit():
        return (2, int(sprint_id))
    nums = re.findall(r"\d+", label)
    if nums:
        return (1, int(nums[-1]))
    return (0, label.lower())


def _build_assignee_buckets(
    issues: list[dict[str, Any]],
    *,
    spent_by_issue: dict[str, int] | None = None,
) -> tuple[list[dict[str, Any]], int, int, int, int]:
    by_assignee: dict[str, dict[str, Any]] = {}
    issues_without_estimate = 0
    grand_planned = 0
    grand_original = 0
    grand_spent = 0
    track_spent = spent_by_issue is not None

    for issue in issues:
        key = issue.get("key")
        if not key:
            continue

        assignee_id, assignee_name = _assignee_label(issue)
        original = _issue_original_estimation_minutes(issue)
        planned = _issue_estimation_minutes(issue)
        spent = spent_by_issue.get(key, 0) if track_spent else 0
        if original <= 0 and planned <= 0:
            issues_without_estimate += 1

        bucket = by_assignee.get(assignee_id)
        if not bucket:
            bucket = {
                "id": assignee_id,
                "name": assignee_name,
                "totalOriginalMinutes": 0,
                "totalOriginalFormatted": "",
                "totalMinutes": 0,
                "totalFormatted": "",
                "totalSpentMinutes": 0,
                "totalSpentFormatted": "",
                "issueCount": 0,
                "issues": [],
            }
            by_assignee[assignee_id] = bucket

        status = (issue.get("status") or {}).get("display") or (issue.get("status") or {}).get("key")
        bucket["issues"].append(
            {
                "issueKey": key,
                "issueTitle": issue.get("summary") or key,
                "issueUrl": f"https://tracker.yandex.ru/{key}",
                "originalMinutes": original,
                "originalFormatted": format_duration(timedelta(minutes=original)) if original else "—",
                "minutes": planned,
                "formatted": format_duration(timedelta(minutes=planned)) if planned else "—",
                "spentMinutes": spent,
                "spentFormatted": format_duration(timedelta(minutes=spent)) if spent else "—",
                "status": status or "",
            }
        )
        bucket["issueCount"] += 1
        bucket["totalOriginalMinutes"] += original
        bucket["totalMinutes"] += planned
        bucket["totalSpentMinutes"] += spent
        grand_original += original
        grand_planned += planned
        grand_spent += spent

    assignees = []
    for bucket in by_assignee.values():
        bucket["issues"].sort(key=lambda row: row["minutes"] or row["originalMinutes"], reverse=True)
        bucket["totalOriginalFormatted"] = format_duration(timedelta(minutes=bucket["totalOriginalMinutes"]))
        bucket["totalFormatted"] = format_duration(timedelta(minutes=bucket["totalMinutes"]))
        bucket["totalSpentFormatted"] = format_duration(timedelta(minutes=bucket["totalSpentMinutes"]))
        assignees.append(bucket)

    assignees.sort(key=lambda row: row["totalMinutes"] or row["totalOriginalMinutes"], reverse=True)
    return assignees, issues_without_estimate, grand_planned, grand_original, grand_spent


def _aggregate_sprint_load_by_agile(
    *,
    issues: list[dict[str, Any]],
    board: dict[str, Any],
    board_id: int,
    name_prefix: str,
    worklogs: list[dict[str, Any]] | None = None,
    sprint_periods: dict[str, tuple[date, date]] | None = None,
) -> dict[str, Any]:
    by_group: dict[str, dict[str, Any]] = {}
    unlabeled: list[dict[str, Any]] = []

    for issue in issues:
        sprint_groups = _agile_sprint_groups_for_issue(
            issue, board_id=board_id, name_prefix=name_prefix
        )
        if not sprint_groups:
            unlabeled.append(issue)
            continue
        for group_key, label, sprint_id, url in sprint_groups:
            bucket = by_group.get(group_key)
            if not bucket:
                bucket = {
                    "key": group_key,
                    "label": label,
                    "sprintId": sprint_id,
                    "url": url,
                    "issues": [],
                }
                by_group[group_key] = bucket
            bucket["issues"].append(issue)

    periods = sprint_periods or {}
    wl = worklogs or []

    groups: list[dict[str, Any]] = []
    for meta in sorted(
        by_group.values(),
        key=lambda g: _sprint_group_sort_key(g["key"], g["label"], g.get("sprintId")),
        reverse=True,
    ):
        sprint_id = meta.get("sprintId")
        period = periods.get(str(sprint_id)) if sprint_id is not None else None
        show_spent = bool(period and wl)
        spent_by_issue: dict[str, int] | None = None
        if show_spent and period:
            date_from, date_to = period
            spent_by_issue = {
                issue["key"]: _worklog_minutes_for_issue(wl, issue["key"], date_from, date_to)
                for issue in meta["issues"]
                if issue.get("key")
            }

        assignees, issues_without_estimate, total_planned, total_original, total_spent = _build_assignee_buckets(
            meta["issues"],
            spent_by_issue=spent_by_issue,
        )
        groups.append(
            {
                "label": meta["label"],
                "sprintId": meta.get("sprintId"),
                "url": meta.get("url"),
                "showSpent": show_spent,
                "sprintStartDate": period[0].isoformat() if period else None,
                "sprintEndDate": period[1].isoformat() if period else None,
                "assignees": assignees,
                "issueCount": sum(a["issueCount"] for a in assignees),
                "issuesWithoutEstimate": issues_without_estimate,
                "totalOriginalMinutes": total_original,
                "totalOriginalFormatted": format_duration(timedelta(minutes=total_original)),
                "totalMinutes": total_planned,
                "totalFormatted": format_duration(timedelta(minutes=total_planned)),
                "totalSpentMinutes": total_spent if show_spent else 0,
                "totalSpentFormatted": format_duration(timedelta(minutes=total_spent))
                if show_spent and total_spent
                else "",
            }
        )

    if unlabeled:
        assignees, issues_without_estimate, total_planned, total_original, total_spent = _build_assignee_buckets(
            unlabeled,
            spent_by_issue=None,
        )
        groups.append(
            {
                "label": "Без спринта",
                "sprintId": None,
                "url": _board_summary(board)["url"],
                "showSpent": False,
                "sprintStartDate": None,
                "sprintEndDate": None,
                "assignees": assignees,
                "issueCount": sum(a["issueCount"] for a in assignees),
                "issuesWithoutEstimate": issues_without_estimate,
                "totalOriginalMinutes": total_original,
                "totalOriginalFormatted": format_duration(timedelta(minutes=total_original)),
                "totalMinutes": total_planned,
                "totalFormatted": format_duration(timedelta(minutes=total_planned)),
                "totalSpentMinutes": 0,
                "totalSpentFormatted": "",
            }
        )

    active = groups[0] if groups else None
    total_issues = sum(g["issueCount"] for g in groups)
    total_planned = sum(g["totalMinutes"] for g in groups)
    total_original = sum(g["totalOriginalMinutes"] for g in groups)
    show_spent_column = any(g.get("showSpent") for g in groups)
    total_spent = sum(g["totalSpentMinutes"] for g in groups) if show_spent_column else 0
    total_without_estimate = sum(g["issuesWithoutEstimate"] for g in groups)

    message = None
    if not issues:
        message = (
            f"На доске {board_id} не найдено задач. Проверьте TRACKER_BOARD_ID в .env."
        )
    elif not groups:
        message = "Задачи на доске есть, но ни у одной не указан спринт во вкладке Agile."

    return {
        "board": _board_summary(board),
        "groupBy": "agile",
        "groups": groups,
        "activeLabel": active["label"] if active else None,
        "sprint": {
            "id": active.get("sprintId") if active else None,
            "name": active["label"],
            "status": "agile",
            "startDate": None,
            "endDate": None,
            "url": active.get("url") or _board_summary(board)["url"],
        }
        if active
        else None,
        "boardOnly": False,
        "message": message,
        "assignees": active["assignees"] if active else [],
        "stats": {
            "issuesOnBoard": len(issues),
            "issuesWithSprint": sum(
                1 for issue in issues if _agile_sprint_groups_for_issue(issue, board_id=board_id, name_prefix=name_prefix)
            ),
        },
        "issueCount": total_issues,
        "issuesWithoutEstimate": total_without_estimate,
        "totalOriginalMinutes": total_original,
        "totalOriginalFormatted": format_duration(timedelta(minutes=total_original)),
        "totalMinutes": total_planned,
        "totalFormatted": format_duration(timedelta(minutes=total_planned)),
        "showSpentColumn": show_spent_column,
        "totalSpentMinutes": total_spent,
        "totalSpentFormatted": format_duration(timedelta(minutes=total_spent))
        if show_spent_column and total_spent
        else "",
    }


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


def _worklog_author_key(entry: dict[str, Any]) -> tuple[str, str]:
    author = entry.get("createdBy") or {}
    login = author.get("login")
    uid = author.get("id")
    display = author.get("display") or login or uid
    key = str(login or uid or display or "__unknown__")
    return key, str(display or key)


def _user_profile_key(user: dict[str, Any]) -> str:
    return str(user.get("login") or user.get("id") or user.get("display") or "")


_PROFILE_ID_FIELDS = ("login", "id", "uid", "passportUid", "cloudUid")


def _profile_match_ids(profile: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for field in _PROFILE_ID_FIELDS:
        val = profile.get(field)
        if val is None:
            continue
        s = str(val).strip()
        if s:
            ids.add(s)
    return ids


def _worklog_matches_user(entry: dict[str, Any], user: dict[str, Any]) -> bool:
    author = entry.get("createdBy") or {}
    if not author or not user:
        return False
    return bool(_profile_match_ids(user) & _profile_match_ids(author))


def aggregate_assignee_worklogs(
    *,
    worklogs: list[dict[str, Any]],
    issue_keys: set[str],
    issue_titles: dict[str, str],
    board: dict[str, Any],
    date_from: date,
    date_to: date,
    assignee_key: str | None,
    current_user: dict[str, Any],
) -> dict[str, Any]:
    by_author: dict[str, dict[str, Any]] = {}
    filtered: list[dict[str, Any]] = []

    for entry in worklogs:
        issue = entry.get("issue") or {}
        key = _issue_key(issue)
        if not key or key not in issue_keys:
            continue
        day = _worklog_day(entry)
        if not day or day < date_from or day > date_to:
            continue
        duration = parse_tracker_duration(entry.get("duration", ""))
        if duration <= timedelta(0):
            continue

        author_key, author_name = _worklog_author_key(entry)
        minutes = int(duration.total_seconds() // 60)

        bucket = by_author.get(author_key)
        if not bucket:
            bucket = {
                "id": author_key,
                "name": author_name,
                "totalMinutes": 0,
                "worklogCount": 0,
            }
            by_author[author_key] = bucket
        bucket["totalMinutes"] += minutes
        bucket["worklogCount"] += 1

        filtered.append(
            {
                "entry": entry,
                "issueKey": key,
                "day": day.isoformat(),
                "minutes": minutes,
                "authorKey": author_key,
                "authorName": author_name,
            }
        )

    assignees = sorted(by_author.values(), key=lambda row: row["totalMinutes"], reverse=True)
    for row in assignees:
        row["totalFormatted"] = format_duration(timedelta(minutes=row["totalMinutes"]))

    me_key = _user_profile_key(current_user)
    me_name = current_user.get("display") or current_user.get("login") or me_key
    current_user_info = {"id": me_key, "name": me_name} if me_key else None

    selected_key = assignee_key
    if not selected_key and assignees:
        if me_key and me_key in by_author:
            selected_key = me_key
        else:
            selected_key = assignees[0]["id"]

    tasks: list[dict[str, Any]] = []
    selected_total = 0
    selected_count = 0

    if selected_key:
        by_issue: dict[str, dict[str, Any]] = {}
        for row in filtered:
            if row["authorKey"] != selected_key:
                continue
            key = row["issueKey"]
            issue_bucket = by_issue.get(key)
            if not issue_bucket:
                issue = row["entry"].get("issue") or {}
                issue_bucket = {
                    "issueKey": key,
                    "issueTitle": issue_titles.get(key) or issue.get("display") or key,
                    "issueUrl": f"https://tracker.yandex.ru/{key}",
                    "totalMinutes": 0,
                    "entries": [],
                }
                by_issue[key] = issue_bucket

            entry = row["entry"]
            issue_bucket["totalMinutes"] += row["minutes"]
            issue_bucket["entries"].append(
                {
                    "id": entry.get("id"),
                    "date": row["day"],
                    "minutes": row["minutes"],
                    "formatted": format_duration(timedelta(minutes=row["minutes"])),
                    "comment": entry.get("comment") or "",
                    "start": entry.get("start"),
                }
            )
            selected_total += row["minutes"]
            selected_count += 1

        for issue_bucket in by_issue.values():
            issue_bucket["entries"].sort(key=lambda e: (e["date"], e.get("start") or ""), reverse=True)
            issue_bucket["totalFormatted"] = format_duration(
                timedelta(minutes=issue_bucket["totalMinutes"])
            )
        tasks = sorted(by_issue.values(), key=lambda t: t["totalMinutes"], reverse=True)

    selected_name = by_author[selected_key]["name"] if selected_key and selected_key in by_author else None

    return {
        "board": _board_summary(board),
        "period": {"from": date_from.isoformat(), "to": date_to.isoformat()},
        "assignees": assignees,
        "currentUser": current_user_info,
        "selectedAssigneeId": selected_key,
        "selectedAssigneeName": selected_name,
        "tasks": tasks,
        "totalMinutes": selected_total,
        "totalFormatted": format_duration(timedelta(minutes=selected_total)),
        "worklogCount": selected_count,
    }


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
    current_user: dict[str, Any] | None = None,
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

        author_key, author_name = _worklog_author_key(entry)
        created_by = entry.get("createdBy") or {}
        task_row["entries"].append(
            {
                "id": entry.get("id"),
                "issueKey": key,
                "duration": entry.get("duration"),
                "minutes": minutes,
                "formatted": format_duration(duration),
                "comment": entry.get("comment") or "",
                "author": author_name,
                "authorKey": author_key,
                "authorLogin": str(created_by.get("login") or ""),
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

    current_user_info = None
    if current_user:
        me_key = _user_profile_key(current_user)
        current_user_info = {
            "id": me_key,
            "login": current_user.get("login"),
            "name": current_user.get("display") or me_key,
        }

    return {
        "board": {
            "id": board.get("id"),
            "name": board.get("name"),
            "url": f"https://tracker.yandex.ru/agile/board/{board.get('id')}",
            "issuesOnBoard": len(issue_keys),
        },
        "period": {"from": date_from.isoformat(), "to": date_to.isoformat()},
        "currentUser": current_user_info,
        "totalMinutes": int(grand_total.total_seconds() // 60),
        "totalFormatted": format_duration(grand_total),
        "days": days,
        "worklogCount": report_stats.get("worklogsInReport", 0),
        "stats": report_stats,
    }