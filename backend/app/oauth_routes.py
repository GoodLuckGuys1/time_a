from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse

from .config import env_snapshot

router = APIRouter(prefix="/oauth", tags=["oauth"])

_CALLBACK_HTML = """<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>OAuth — Yandex Tracker</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    code, pre { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 4px; word-break: break-all; }
    pre { padding: 1rem; overflow-x: auto; }
    .ok { color: #0a7; } .err { color: #c33; }
  </style>
</head>
<body>
  <h1>Получение OAuth-токена</h1>
  <p id="status">Обработка ответа…</p>
  <pre id="token" hidden></pre>
  <script>
    const status = document.getElementById("status");
    const pre = document.getElementById("token");
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get("access_token");
    const err = params.get("error") || new URLSearchParams(location.search).get("error");

    if (err) {
      status.className = "err";
      status.textContent = "Ошибка: " + err + (params.get("error_description") ? " — " + params.get("error_description") : "");
    } else if (token) {
      const granted = params.get("scope") || "(scope не указан в ответе)";
      const hasWrite = granted.includes("tracker:write");
      status.className = hasWrite ? "ok" : "err";
      status.innerHTML = hasWrite
        ? "Токен с <code>tracker:write</code> получен. Скопируйте в <code>.env</code> → <code>TRACKER_OAUTH_TOKEN=</code> и перезапустите backend."
        : "Токен получен <strong>без tracker:write</strong>. В OAuth-приложении добавьте право «Запись в трекер», откройте /oauth/start снова.";
      pre.hidden = false;
      pre.textContent = "access_token=" + token + "\\nscope=" + granted;
    } else {
      status.className = "err";
      status.textContent = "Токен не найден в ответе. Откройте /oauth/start и войдите в аккаунт снова.";
    }
  </script>
</body>
</html>
"""

_SETUP_HTML = """<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>Настройка OAuth</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }}
    code {{ background: #f4f4f4; padding: 0.15rem 0.35rem; border-radius: 4px; }}
    ol {{ padding-left: 1.25rem; }}
    .warn {{ background: #fff3cd; padding: 0.75rem 1rem; border-radius: 8px; }}
  </style>
</head>
<body>
  <h1>Настройка OAuth для Tracker</h1>
  <p class="warn">Мастер «1 из 5» с платформами Web/iOS/Android — это <strong>не то</strong>.
  Нужна отдельная форма «Для доступа к API».</p>
  <ol>
    <li>Откройте <a href="https://oauth.yandex.ru/client/new/id">oauth.yandex.ru/client/new/id</a>
        (или «Создать» → <strong>Для доступа к API или отладки</strong>)</li>
    <li>Название, почта, в поле доступов: <code>tracker:read</code> и <code>tracker:write</code> (запись нужна для редактирования времени в приложении)</li>
    <li>Client ID → <code>TRACKER_OAUTH_CLIENT_ID</code>, Client secret → <code>TRACKER_OAUTH_CLIENT_SECRET</code> в .env</li>
    <li>В .env: <code>TRACKER_OAUTH_SCOPE=tracker:read tracker:write</code></li>
    <li>Токен: <a href="/oauth/start">/oauth/start</a> (откроется страница verification_code с токеном)</li>
  </ol>
</body>
</html>
"""


@router.get("/callback", response_class=HTMLResponse)
async def oauth_callback() -> str:
    return _CALLBACK_HTML


@router.get("/start", response_model=None)
async def oauth_start():
    cfg = env_snapshot()
    if not cfg.oauth_client_id:
        return HTMLResponse(
            _SETUP_HTML.format(redirect_uri=cfg.oauth_redirect_uri),
            status_code=200,
        )

    client_id = quote(cfg.oauth_client_id, safe="")
    scope_raw = " ".join(cfg.oauth_scope.replace(",", " ").split()) or "tracker:read tracker:write"
    scope = quote(scope_raw, safe="")
    redirect_uri = quote(cfg.oauth_redirect_uri, safe="")
    url = (
        "https://oauth.yandex.ru/authorize"
        f"?response_type=token"
        f"&client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&scope={scope}"
        f"&force_confirm=yes"
    )
    return RedirectResponse(url, status_code=302)
