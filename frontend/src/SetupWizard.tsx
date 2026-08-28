import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchConfig,
  saveConfig,
  testOrgId,
  type ConfigStatus,
} from "./api";

type SetupStep = "oauth_app" | "token" | "org" | "done";

interface SetupWizardProps {
  cfg: ConfigStatus;
  onConfigured: (cfg: ConfigStatus) => void;
}

const ORG_SCRIPT = `(function () {
  const hits = new Set();
  const re = /(?:orgId|organizationId|cloudOrgId|org_id|x-org-id|x-cloud-org-id)["':\\s]+([0-9a-f]{8,}|[0-9]{5,})/gi;
  const scan = (s) => { let m; while ((m = re.exec(s || ''))) hits.add(m[1]); };
  scan(document.documentElement.innerHTML);
  for (const k of Object.keys(localStorage)) scan(localStorage.getItem(k));
  for (const k of Object.keys(sessionStorage)) scan(sessionStorage.getItem(k));
  console.log('Возможные Org ID:', [...hits]);
  return [...hits];
})();`;

function stepFromConfig(cfg: ConfigStatus): SetupStep {
  if (cfg.configured) return "done";
  if (cfg.setupStep === "token") return "token";
  if (cfg.setupStep === "org") return "org";
  return "oauth_app";
}

export function SetupWizard({ cfg, onConfigured }: SetupWizardProps) {
  const [step, setStep] = useState<SetupStep>(() => stepFromConfig(cfg));
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [token, setToken] = useState("");
  const [orgId, setOrgId] = useState("");
  const [orgHeader, setOrgHeader] = useState(cfg.orgHeader || "X-Org-ID");
  const [boardId, setBoardId] = useState(String(cfg.boardId || 288));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgHint, setOrgHint] = useState<string | null>(null);
  const [showOrgScript, setShowOrgScript] = useState(false);

  useEffect(() => {
    setStep(stepFromConfig(cfg));
    setOrgHeader(cfg.orgHeader || "X-Org-ID");
    setBoardId(String(cfg.boardId || 288));
  }, [cfg]);

  const stepIndex = useMemo(() => {
    if (step === "oauth_app") return 1;
    if (step === "token") return 2;
    return 3;
  }, [step]);

  const saveAndAdvance = useCallback(
    async (payload: Parameters<typeof saveConfig>[0], next?: SetupStep) => {
      setBusy(true);
      setError(null);
      try {
        const nextCfg = await saveConfig(payload);
        if (nextCfg.configured) {
          onConfigured(nextCfg);
          return;
        }
        if (next) setStep(next);
        else setStep(stepFromConfig(nextCfg));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      } finally {
        setBusy(false);
      }
    },
    [onConfigured],
  );

  const handleOAuthApp = () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("Укажите Client ID и Client Secret");
      return;
    }
    void saveAndAdvance(
      { oauthClientId: clientId.trim(), oauthClientSecret: clientSecret.trim() },
      "token",
    );
  };

  const handleToken = () => {
    if (!token.trim()) {
      setError("Вставьте токен с страницы Яндекса");
      return;
    }
    void saveAndAdvance({ oauthToken: token.trim() }, "org");
  };

  const handleTestOrg = async () => {
    if (!orgId.trim()) {
      setError("Укажите ID организации");
      return;
    }
    setBusy(true);
    setError(null);
    setOrgHint("Проверка…");
    try {
      const r = await testOrgId(orgId.trim(), orgHeader);
      if (r.ok) {
        setOrgHint(`Подходит: ${r.display ?? "OK"}`);
      } else if ("hint" in r && typeof r.hint === "string") {
        setOrgHint(r.hint);
        setError(r.hint);
      } else {
        setOrgHint("Не подошло — попробуйте другой ID или заголовок X-Cloud-Org-ID");
      }
    } catch (e) {
      setOrgHint(null);
      setError(e instanceof Error ? e.message : "Ошибка проверки");
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = () => {
    if (!orgId.trim()) {
      setError("Укажите ID организации");
      return;
    }
    void saveAndAdvance({
      orgId: orgId.trim(),
      orgHeader,
      boardId: Number(boardId) || cfg.boardId || 288,
    });
  };

  const openOAuth = () => {
    window.open(cfg.oauthStartUrl ?? "/oauth/start", "_blank", "noopener,noreferrer");
  };

  return (
    <div className="setup-backdrop" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <section className="setup-modal card">
        <header className="setup-header">
          <p className="setup-kicker">Первый запуск · шаг {stepIndex} из 3</p>
          <h2 id="setup-title">Подключение к Yandex Tracker</h2>
          <p className="setup-lead">
            Всё настраивается здесь — править файлы и перезапускать сервер не нужно.
          </p>
        </header>

        <ol className="setup-steps">
          <li className={step === "oauth_app" ? "active" : stepIndex > 1 ? "done" : ""}>
            OAuth-приложение
          </li>
          <li className={step === "token" ? "active" : stepIndex > 2 ? "done" : ""}>Токен</li>
          <li className={step === "org" ? "active" : ""}>Организация</li>
        </ol>

        {step === "oauth_app" && (
          <div className="setup-panel">
            <p>
              Создайте приложение{" "}
              <a href="https://oauth.yandex.ru/client/new/id" target="_blank" rel="noreferrer">
                «Для доступа к API»
              </a>{" "}
              с правами <code>tracker:read</code> и <code>tracker:write</code>.
            </p>
            <label className="field setup-field">
              <span>Client ID</span>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="из oauth.yandex.ru"
                autoComplete="off"
              />
            </label>
            <label className="field setup-field">
              <span>Client Secret</span>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="секрет приложения"
                autoComplete="off"
              />
            </label>
            <div className="setup-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={handleOAuthApp}>
                {busy ? "Сохранение…" : "Далее"}
              </button>
            </div>
          </div>
        )}

        {step === "token" && (
          <div className="setup-panel">
            <p>
              Нажмите кнопку — откроется авторизация Яндекса. На странице с кодом скопируйте{" "}
              <code>access_token</code> и вставьте ниже.
            </p>
            <div className="setup-actions">
              <button type="button" className="btn btn-secondary" onClick={openOAuth}>
                Открыть авторизацию
              </button>
            </div>
            <label className="field setup-field">
              <span>Токен</span>
              <textarea
                className="setup-textarea"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="y0_AgAAAA… или access_token=…"
                rows={3}
              />
            </label>
            <div className="setup-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setStep("oauth_app")}>
                Назад
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={handleToken}>
                {busy ? "Сохранение…" : "Далее"}
              </button>
            </div>
          </div>
        )}

        {step === "org" && (
          <div className="setup-panel">
            <p>ID организации Tracker — число из админки или консоли браузера на доске.</p>
            <label className="field setup-field">
              <span>ID организации</span>
              <input
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                placeholder="например 12345678"
              />
            </label>
            <label className="field setup-field">
              <span>Заголовок</span>
              <select value={orgHeader} onChange={(e) => setOrgHeader(e.target.value)}>
                <option value="X-Org-ID">X-Org-ID (Яндекс 360)</option>
                <option value="X-Cloud-Org-ID">X-Cloud-Org-ID (Yandex Cloud)</option>
              </select>
            </label>
            <label className="field setup-field">
              <span>Доска (ID из URL)</span>
              <input
                value={boardId}
                onChange={(e) => setBoardId(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <p className="setup-help">
              <button type="button" className="link-btn" onClick={() => setShowOrgScript((v) => !v)}>
                {showOrgScript ? "Скрыть скрипт" : "Как найти Org ID в браузере"}
              </button>
            </p>
            {showOrgScript && (
              <div className="org-help-box">
                <p>
                  Откройте{" "}
                  <a href={`https://tracker.yandex.ru/agile/board/${boardId || 288}`} target="_blank" rel="noreferrer">
                    доску в Tracker
                  </a>
                  , F12 → Консоль, вставьте скрипт:
                </p>
                <pre className="setup-script">{ORG_SCRIPT}</pre>
              </div>
            )}
            <div className="setup-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setStep("token")}>
                Назад
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void handleTestOrg()}>
                Проверить
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={handleFinish}>
                {busy ? "Сохранение…" : "Готово"}
              </button>
            </div>
            {orgHint && <p className="setup-hint">{orgHint}</p>}
          </div>
        )}

        {error && <p className="setup-error">{error}</p>}
      </section>
    </div>
  );
}