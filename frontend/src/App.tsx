import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCheckWriteAccess,
  fetchConfig,
  fetchTimeReport,
  testOrgId,
  type ConfigStatus,
} from "./api";
import { LoadingOverlay, LoadingPanel, LoadingSpinner } from "./LoadingSpinner";
import { TempoTimesheet } from "./TempoTimesheet";
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

export default function App() {
  const initial = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<Awaited<ReturnType<typeof fetchTimeReport>> | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [cfg, setCfg] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(false);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchTimeReport(from, to));
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

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

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Yandex Tracker · доска 288</p>
          <h1>Учёт времени</h1>
          <p className="subtitle">Сетка Timesheet в стиле Tempo — задачи × дни.</p>
        </div>
        {report?.board && (
          <a className="board-link" href={report.board.url} target="_blank" rel="noreferrer">
            {report.board.name || `Доска ${report.board.id}`}
          </a>
        )}
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
              <button type="button" onClick={checkOrg}>
                Проверить
              </button>
              {orgTestMsg && <p className="org-test-msg">{orgTestMsg}</p>}
            </div>
          )}
        </section>
      )}

      <section className="controls card">
        <label>
          С
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          По
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn-secondary"
          title="Показать только сегодняшний день"
          onClick={() => {
            const t = localDateString();
            setFrom(t);
            setTo(t);
          }}
        >
          Сегодня
        </button>
        <button type="button" className={loading ? "btn-loading" : undefined} onClick={load} disabled={loading || !configured}>
          {loading && <LoadingSpinner size="sm" label="Загрузка" />}
          {loading ? "Загрузка…" : "Обновить"}
        </button>
      </section>

      {configured === null && <LoadingPanel message="Проверка настроек…" />}

      {error && (
        <section className="banner banner-error">
          <strong>Ошибка</strong>
          <pre className="error-text">{error}</pre>
        </section>
      )}

      {configured && loading && !report && <LoadingPanel message="Загрузка отчёта…" />}

      {configured && writeAccess && !writeAccess.ok && (
        <section className="banner banner-warn">
          <strong>Токен без права записи (tracker:write)</strong>
          <p>
            Текущий токен выдан только с <code>tracker:read</code>. Смена строки в .env не меняет права
            уже выданного токена.
          </p>
          <ol>
            <li>
              Откройте приложение OAuth:{" "}
              {cfg?.oauthAppInfoUrl ? (
                <a href={cfg.oauthAppInfoUrl} target="_blank" rel="noreferrer">
                  настройки приложения
                </a>
              ) : (
                <a href="https://oauth.yandex.ru/" target="_blank" rel="noreferrer">
                  oauth.yandex.ru
                </a>
              )}{" "}
              → добавьте право <strong>«Запись в трекер»</strong> (<code>tracker:write</code>) → сохраните.
            </li>
            <li>
              Получите <strong>новый</strong> токен:{" "}
              <a href={cfg?.oauthStartUrl ?? "/oauth/start"} target="_blank" rel="noreferrer">
                /oauth/start
              </a>{" "}
              (на экране должны быть оба права; в ответе — <code>tracker:write</code> в scope).
            </li>
            <li>
              Вставьте токен в <code>TRACKER_OAUTH_TOKEN</code> в .env и перезапустите backend.
            </li>
          </ol>
          {writeAccess.message && <pre className="error-text">{writeAccess.message}</pre>}
        </section>
      )}

      {report && (
        <div className="loading-host">
          {loading && <LoadingOverlay message="Обновление данных…" />}
          <section className="stats">
            <article className="stat card">
              <span className="stat-label">Всего за период</span>
              <strong className="stat-value">{report.totalFormatted}</strong>
            </article>
            <article className="stat card">
              <span className="stat-label">Записей</span>
              <strong className="stat-value">{report.worklogCount}</strong>
            </article>
            <article className="stat card">
              <span className="stat-label">Задач на доске</span>
              <strong className="stat-value">{report.board.issuesOnBoard}</strong>
            </article>
            <article className="stat card">
              <span className="stat-label">Дней с работой</span>
              <strong className="stat-value">{report.days.length}</strong>
            </article>
          </section>

          {report.days.length === 0 ? (
            <>
              <p className="empty card">За период списаний не найдено.</p>
              <TempoTimesheet
                report={report}
                canEdit={writeAccess?.ok !== false}
                writeAccessMessage={writeAccess?.message}
                onRefresh={async () => {
                  await load();
                  if (configured) {
                    fetchCheckWriteAccess().then(setWriteAccess).catch(() => undefined);
                  }
                }}
              />
            </>
          ) : (
            <TempoTimesheet
              report={report}
              canEdit={writeAccess?.ok !== false}
              writeAccessMessage={writeAccess?.message}
              onRefresh={async () => {
                await load();
                if (configured) {
                  fetchCheckWriteAccess().then(setWriteAccess).catch(() => undefined);
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
