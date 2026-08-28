import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCheckWriteAccess,
  fetchConfig,
  fetchTimeReport,
  type ConfigStatus,
  type TimeReport,
} from "./api";
import { LoadingOverlay, LoadingPanel, LoadingSpinner } from "./LoadingSpinner";
import { SetupWizard } from "./SetupWizard";
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
  const [writeAccess, setWriteAccess] = useState<{ ok: boolean; message?: string } | null>(null);

  const refreshConfig = useCallback(async () => {
    const c = await fetchConfig();
    setCfg(c);
    setConfigured(c.configured);
    return c;
  }, []);

  useEffect(() => {
    refreshConfig()
      .then((c) => {
        if (c.configured) {
          fetchCheckWriteAccess().then(setWriteAccess).catch(() => setWriteAccess({ ok: false }));
        }
      })
      .catch(() => setConfigured(false));
  }, [refreshConfig]);

  const handleConfigured = useCallback(
    (next: ConfigStatus) => {
      setCfg(next);
      setConfigured(true);
      fetchCheckWriteAccess().then(setWriteAccess).catch(() => setWriteAccess({ ok: false }));
    },
    [],
  );

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

      {configured === false && cfg && <SetupWizard cfg={cfg} onConfigured={handleConfigured} />}

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
            Получить новый токен
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
