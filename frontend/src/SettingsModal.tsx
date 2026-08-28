import { useEffect, useState } from "react";

import { fetchCheckWriteAccess, saveConfig, testOrgId, type ConfigStatus } from "./api";

interface SettingsModalProps {
  cfg: ConfigStatus;
  onClose: () => void;
  onSaved: (cfg: ConfigStatus) => void;
}

function parseLogins(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function SettingsModal({ cfg, onClose, onSaved }: SettingsModalProps) {
  const [tab, setTab] = useState<"connection" | "people">("connection");
  const [orgId, setOrgId] = useState(cfg.orgId ?? "");
  const [orgHeader, setOrgHeader] = useState(cfg.orgHeader || "X-Org-ID");
  const [boardId, setBoardId] = useState(String(cfg.boardId || 288));
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [extraLogins, setExtraLogins] = useState((cfg.extraWorklogLogins ?? []).join("\n"));
  const [showOAuth, setShowOAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [writeOk, setWriteOk] = useState<boolean | null>(null);
  const [resolvedMap, setResolvedMap] = useState<Record<string, string>>({});
  const [unresolved, setUnresolved] = useState<string[]>([]);

  useEffect(() => {
    setOrgId(cfg.orgId ?? "");
    setOrgHeader(cfg.orgHeader || "X-Org-ID");
    setBoardId(String(cfg.boardId || 288));
    setExtraLogins((cfg.extraWorklogLogins ?? []).join("\n"));
  }, [cfg]);

  useEffect(() => {
    fetchCheckWriteAccess()
      .then((r) => setWriteOk(r.ok))
      .catch(() => setWriteOk(null));
  }, []);

  const openOAuth = () => {
    window.open(cfg.oauthStartUrl ?? "/oauth/start", "_blank", "noopener,noreferrer");
  };

  const handleTestOrg = async () => {
    if (!orgId.trim()) {
      setError("Укажите ID организации");
      return;
    }
    setBusy(true);
    setError(null);
    setHint("Проверка…");
    try {
      const r = await testOrgId(orgId.trim(), orgHeader);
      if (r.ok) {
        setHint(`Подходит: ${r.display ?? "OK"}`);
      } else if ("hint" in r && typeof r.hint === "string") {
        setHint(r.hint);
        setError(r.hint);
      } else {
        setHint("Не подошло");
        setError("Проверьте ID или заголовок X-Cloud-Org-ID");
      }
    } catch (e) {
      setHint(null);
      setError(e instanceof Error ? e.message : "Ошибка проверки");
    } finally {
      setBusy(false);
    }
  };

  const saveConnection = async () => {
    if (!orgId.trim()) {
      setError("Укажите ID организации");
      return;
    }
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const payload: Parameters<typeof saveConfig>[0] = {
        orgId: orgId.trim(),
        orgHeader,
        boardId: Number(boardId) || cfg.boardId || 288,
      };
      if (token.trim()) payload.oauthToken = token.trim();
      if (clientId.trim()) payload.oauthClientId = clientId.trim();
      if (clientSecret.trim()) payload.oauthClientSecret = clientSecret.trim();
      const next = await saveConfig(payload);
      setToken("");
      setClientSecret("");
      onSaved(next);
      setHint("Подключение сохранено");
      const wa = await fetchCheckWriteAccess();
      setWriteOk(wa.ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const savePeople = async () => {
    setBusy(true);
    setError(null);
    setHint(null);
    setResolvedMap({});
    setUnresolved([]);
    try {
      const next = await saveConfig({ extraWorklogLogins: parseLogins(extraLogins) });
      onSaved(next);
      setExtraLogins((next.extraWorklogLogins ?? []).join("\n"));
      const resolved = next.extraWorklogResolved ?? {};
      const failed = next.extraWorklogUnresolved ?? [];
      setResolvedMap(resolved);
      setUnresolved(failed);
      if (failed.length > 0) {
        setError(`Не найдены в Tracker: ${failed.join(", ")}`);
        setHint(
          Object.keys(resolved).length > 0
            ? "Остальные сотрудники сохранены — обновите табель"
            : null,
        );
      } else if (Object.keys(resolved).length > 0) {
        const pairs = Object.entries(resolved)
          .filter(([from, to]) => from !== to)
          .map(([from, to]) => `${from} → ${to}`);
        setHint(
          pairs.length > 0
            ? `Сохранено. Логины: ${pairs.join(", ")}. Обновите табель.`
            : "Список сотрудников сохранён — обновите табель",
        );
      } else {
        setHint("Список сотрудников сохранён — обновите табель");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const loginList = parseLogins(extraLogins);

  return (
    <div className="setup-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={onClose}>
      <section className="setup-modal card settings-modal" onClick={(e) => e.stopPropagation()}>
        <header className="setup-header settings-header">
          <div>
            <p className="setup-kicker">Настройки</p>
            <h2 id="settings-title">Tracker и сотрудники</h2>
          </div>
          <button type="button" className="btn btn-ghost btn-icon settings-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className="settings-tabs segment">
          <button type="button" className={tab === "connection" ? "active" : ""} onClick={() => setTab("connection")}>
            Подключение
          </button>
          <button type="button" className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>
            Сотрудники
            {loginList.length > 0 && <span className="settings-tab-badge">{loginList.length}</span>}
          </button>
        </div>

        {tab === "connection" && (
          <div className="setup-panel">
            <p className="settings-status">
              Токен: {cfg.hasToken ? "✓ задан" : "— нет"}
              {writeOk === true && " · запись разрешена"}
              {writeOk === false && " · только чтение"}
            </p>

            <label className="field setup-field">
              <span>ID организации</span>
              <input value={orgId} onChange={(e) => setOrgId(e.target.value)} />
            </label>
            <label className="field setup-field">
              <span>Заголовок</span>
              <select value={orgHeader} onChange={(e) => setOrgHeader(e.target.value)}>
                <option value="X-Org-ID">X-Org-ID (Яндекс 360)</option>
                <option value="X-Cloud-Org-ID">X-Cloud-Org-ID (Yandex Cloud)</option>
              </select>
            </label>
            <label className="field setup-field">
              <span>Доска (ID)</span>
              <input value={boardId} onChange={(e) => setBoardId(e.target.value)} inputMode="numeric" />
            </label>

            <label className="field setup-field">
              <span>Новый токен (необязательно)</span>
              <textarea
                className="setup-textarea"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Вставьте access_token после /oauth/start"
                rows={2}
              />
            </label>
            <div className="setup-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={openOAuth}>
                Получить токен
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void handleTestOrg()}>
                Проверить Org ID
              </button>
            </div>

            <p className="setup-help">
              <button type="button" className="link-btn" onClick={() => setShowOAuth((v) => !v)}>
                {showOAuth ? "Скрыть OAuth-приложение" : "OAuth Client ID / Secret"}
              </button>
            </p>
            {showOAuth && (
              <>
                <label className="field setup-field">
                  <span>Client ID</span>
                  <input
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder={cfg.hasClientId ? "оставьте пустым, чтобы не менять" : ""}
                    autoComplete="off"
                  />
                </label>
                <label className="field setup-field">
                  <span>Client Secret</span>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="оставьте пустым, чтобы не менять"
                    autoComplete="off"
                  />
                </label>
              </>
            )}

            <div className="setup-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveConnection()}>
                {busy ? "Сохранение…" : "Сохранить подключение"}
              </button>
            </div>
          </div>
        )}

        {tab === "people" && (
          <div className="setup-panel">
            <p>
              Логин Tracker (<code>ivan.bazhanov</code>) или корпоративная почта. Их списания подгружаются при
              загрузке табеля, даже если человек не исполнитель на доске. По одному на строку или через запятую.
            </p>
            <label className="field setup-field">
              <span>Список сотрудников</span>
              <textarea
                className="setup-textarea settings-logins"
                value={extraLogins}
                onChange={(e) => setExtraLogins(e.target.value)}
                placeholder={"ivan.bazhanov\nivan@company.ru"}
                rows={6}
              />
            </label>
            {loginList.length > 0 ? (
              <ul className="settings-login-chips">
                {loginList.map((login) => (
                  <li key={login}>{login}</li>
                ))}
              </ul>
            ) : (
              <p className="settings-empty">Список пуст — загружаются только исполнители с доски и вы.</p>
            )}
            {Object.keys(resolvedMap).length > 0 && (
              <ul className="settings-login-chips settings-resolved">
                {Object.entries(resolvedMap).map(([from, to]) => (
                  <li key={from}>
                    {from === to ? to : `${from} → ${to}`}
                  </li>
                ))}
              </ul>
            )}
            {unresolved.length > 0 && (
              <p className="setup-error">Не найдены: {unresolved.join(", ")}</p>
            )}
            <div className="setup-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void savePeople()}>
                {busy ? "Сохранение…" : "Сохранить список"}
              </button>
            </div>
          </div>
        )}

        {hint && <p className="setup-hint">{hint}</p>}
        {error && <p className="setup-error">{error}</p>}
      </section>
    </div>
  );
}
