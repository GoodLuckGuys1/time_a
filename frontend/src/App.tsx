import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCheckWriteAccess,
  fetchConfig,
  fetchTimeReport,
  testOrgId,
  type ConfigStatus,
  type TimeReport,
} from "./api";
import { LoadingOverlay, LoadingPanel, LoadingSpinner } from "./LoadingSpinner";
import { TempoTimesheet } from "./TempoTimesheet";
import { mergeAssigneeIntoReport } from "./tempoData";
import "./App.css";

/** Календарная дата в локальной зоне браузера (не UTC из toISOString). */
function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: localDateString(from),
    to: localDateString(to),
  };
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

export default function App() {
  const initial = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<TimeReport | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [cfg, setCfg] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [assigneeRefreshing, setAssigneeRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgInput, setOrgInput] = useState("");
  const [orgHeader, setOrgHeader] = useState("X-Org-ID");
  const [orgTestMsg, setOrgTestMsg] = useState<string | null>(null);
  const [showOrgHelp, setShowOrgHelp] = useState(false);
  const [writeAccess, setWriteAccess] = useState<{ ok: boolean; message?: string } | null>(null);

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setCfg(c);
        setConfigured(c.configured);
        if (c.configured) {
          fetchCheckWriteAccess().then(setWriteAccess).catch(() => setWriteAccess({ ok: false }));
        }
      })
      .catch(() => setConfigured(false));
  }, []);

  const load = useCallback(async (everyone = false) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchTimeReport(from, to, everyone ? "__all__" : undefined));
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  const refreshAssignee = useCallback(
    async (assigneeId: string) => {
      if (assigneeId === "__all__") {
        await load(true);
        return;
      }
      setAssigneeRefreshing(true);
      setError(null);
      try {
        const patch = await fetchTimeReport(from, to, assigneeId);
        setReport((prev) => (prev ? mergeAssigneeIntoReport(prev, patch, assigneeId) : patch));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось обновить исполнителя");
      } finally {
        setAssigneeRefreshing(false);
      }
    },
    [from, to, load],
  );

  const handleTimesheetRefresh = useCallback(async () => {
    await load(report?.scope === "all");
    if (configured) {
      fetchCheckWriteAccess().then(setWriteAccess).catch(() => undefined);
    }
  }, [load, configured, report?.scope]);

  useEffect(() => {
    if (configured) load();
  }, [configured, load]);

  const checkOrg = async () => {
    if (!orgInput.trim()) return;
    setOrgTestMsg("Проверка…");
    try {
      const r = await testOrgId(orgInput.trim(), orgHeader);
      if (r.ok) {
        setOrgTestMsg(`Подходит: ${r.display ?? "OK"}. Вставьте в .env: TRACKER_ORG_ID=${orgInput.trim()}`);
      } else if ("hint" in r && typeof (r as { hint?: string }).hint === "string") {
        setOrgTestMsg((r as { hint: string }).hint);
      } else {
        setOrgTestMsg("Не подошло. Попробуйте другой ID или X-Cloud-Org-ID.");
      }
    } catch {
      setOrgTestMsg("Ошибка проверки. Убедитесь, что TRACKER_OAUTH_TOKEN задан и backend запущен.");
    }
  };

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setFrom(localDateString(start));
    setTo(localDateString(end));
  };

  const boardName = report?.board.name || (report ? `Доска ${report.board.id}` : cfg?.boardId ? `Доска ${cfg.boardId}` : null);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-mark" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 7v5.2l3.2 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <h1>Учёт времени</h1>
          {report?.board ? (
            <a className="app-board" href={report.board.url} target="_blank" rel="noreferrer">
              {boardName}
            </a>
          ) : (
            <span className="app-board muted">{boardName || "Tracker"}</span>
          )}
        </div>

        {report && (
          <div className="app-metrics" aria-label="Сводка за период">
            <span>
              <strong>{report.totalFormatted || "0h"}</strong> списано
            </span>
            <span>
              <strong>{report.worklogCount}</strong> зап.
            </span>
            <span>
              <strong>{report.board.issuesOnBoard}</strong> задач
            </span>
            <span className={`scope-chip${report.scope === "all" ? " is-all" : ""}`}>
              {report.scope === "all" ? "Все" : "Вы"}
            </span>
          </div>
        )}

        <div className="app-period">
          <div className="period-presets" role="group" aria-label="Быстрый период">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreset(1)}>
              День
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreset(7)}>
              Нед.
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreset(30)}>
              30д
            </button>
          </div>
          <input
            type="date"
            aria-label="С"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="period-dash">–</span>
          <input
            type="date"
            aria-label="По"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <div className="period-step">
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              title="На неделю назад"
              onClick={() => {
                setFrom(shiftDays(from, -7));
                setTo(shiftDays(to, -7));
              }}
            >
              ‹
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              title="На неделю вперёд"
              onClick={() => {
                setFrom(shiftDays(from, 7));
                setTo(shiftDays(to, 7));
              }}
            >
              ›
            </button>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => load(report?.scope === "all")}
            disabled={loading || !configured}
          >
            {loading && <LoadingSpinner size="sm" label="Загрузка" />}
            {loading ? "…" : "Обновить"}
          </button>
        </div>
      </header>

      {configured === false && cfg && (
        <section className="banner banner-warn setup-guide">
          <strong>Осталось настроить API</strong>
          <p>
            Файл: <code>{cfg.envPath}</code>. Создайте приложение{" "}
            <a href="https://oauth.yandex.ru/client/new/id" target="_blank" rel="noreferrer">
              для доступа к API
            </a>{" "}
            с правами <code>tracker:read</code> и для редактирования времени —{" "}
            <code>tracker:write</code>.
          </p>
          <ul className="checklist">
            <li className={cfg.hasClientId ? "done" : "todo"}>
              TRACKER_OAUTH_CLIENT_ID {cfg.hasClientId ? "✓" : "— укажите Client ID"}
            </li>
            <li className={cfg.hasToken ? "done" : "todo"}>
              TRACKER_OAUTH_TOKEN{" "}
              {cfg.hasToken ? (
                <>
                  ✓ — scope <em>{cfg.oauthScope ?? "tracker:read"}</em>{" "}
                  <a href={cfg.oauthStartUrl ?? "/oauth/start"} target="_blank" rel="noreferrer">
                    перевыпустить
                  </a>
                </>
              ) : cfg.hasClientId ? (
                <>
                  —{" "}
                  <a href={cfg.oauthStartUrl ?? "/oauth/start"} target="_blank" rel="noreferrer">
                    получить токен
                  </a>
                </>
              ) : (
                "— сначала Client ID"
              )}
            </li>
            <li className={cfg.hasOrgId ? "done" : "todo"}>
              TRACKER_ORG_ID{" "}
              {cfg.hasOrgId ? (
                "✓"
              ) : (
                <button type="button" className="link-btn" onClick={() => setShowOrgHelp((v) => !v)}>
                  как узнать ID
                </button>
              )}
            </li>
          </ul>
          {showOrgHelp && !cfg.hasOrgId && (
            <div className="org-help-box">
              <p>
                F12 → Консоль на{" "}
                <a href="https://tracker.yandex.ru/agile/board/288" target="_blank" rel="noreferrer">
                  доске 288
                </a>
                , скрипт для Org ID — в{" "}
                <a href="http://127.0.0.1:8000/oauth/org-help" target="_blank" rel="noreferrer">
                  инструкции
                </a>
                .
              </p>
            </div>
          )}
          {!cfg.hasOrgId && cfg.hasToken && (
            <div className="org-test">
              <label>
                Проверить ID
                <input value={orgInput} onChange={(e) => setOrgInput(e.target.value)} />
              </label>
              <label>
                Заголовок
                <select value={orgHeader} onChange={(e) => setOrgHeader(e.target.value)}>
                  <option value="X-Org-ID">X-Org-ID</option>
                  <option value="X-Cloud-Org-ID">X-Cloud-Org-ID</option>
                </select>
              </label>
              <button type="button" className="btn btn-secondary" onClick={checkOrg}>
                Проверить
              </button>
              {orgTestMsg && <p className="org-test-msg">{orgTestMsg}</p>}
            </div>
          )}
        </section>
      )}

      {configured === null && <LoadingPanel message="Проверка настроек…" />}

      {error && (
        <section className="banner banner-error">
          <strong>Не удалось загрузить данные</strong>
          <pre className="error-text">{error}</pre>
        </section>
      )}

      {configured && (loading || assigneeRefreshing) && !report && (
        <LoadingPanel message="Загрузка ваших задач…" />
      )}

      {configured && writeAccess && !writeAccess.ok && (
        <p className="banner banner-warn banner-compact">
          Только просмотр — нужен <code>tracker:write</code>.{" "}
          <a href={cfg?.oauthStartUrl ?? "/oauth/start"} target="_blank" rel="noreferrer">
            Новый токен
          </a>
        </p>
      )}

      {report && (
        <div className="loading-host workspace">
          {(loading || assigneeRefreshing) && (
            <LoadingOverlay
              message={assigneeRefreshing ? "Обновление исполнителя…" : "Обновление данных…"}
            />
          )}
          <TempoTimesheet
            report={report}
            canEdit={writeAccess?.ok !== false}
            writeAccessMessage={writeAccess?.message}
            assigneeRefreshing={assigneeRefreshing}
            onRefresh={handleTimesheetRefresh}
            onRefreshAssignee={refreshAssignee}
            onLoadEveryone={() => load(true)}
            everyoneLoaded={report.scope === "all"}
            everyoneLoading={loading && report.scope !== "all"}
          />
        </div>
      )}
    </div>
  );
}
