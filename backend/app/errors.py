SCOPE_HINT = (
    "Добавьте в OAuth-приложении право «Чтение из трекера» (tracker:read) на "
    "https://oauth.yandex.ru/ → откройте приложение → Права доступа. "
    "Затем получите новый токен: http://127.0.0.1:8000/oauth/start "
    "(старый токен права не подхватит)."
)

WRITE_SCOPE_HINT = (
    "Для редактирования списаний нужно право «Запись в трекер» (tracker:write). "
    "В OAuth-приложении добавьте tracker:write, в .env укажите "
    "TRACKER_OAUTH_SCOPE=tracker:read tracker:write и получите новый токен: "
    "http://127.0.0.1:8000/oauth/start"
)


def format_api_error(detail: object) -> str:
    if isinstance(detail, list):
        text = "; ".join(str(x) for x in detail)
    elif isinstance(detail, dict):
        messages = detail.get("errorMessages")
        if isinstance(messages, list):
            text = "; ".join(str(x) for x in messages)
        else:
            text = str(detail)
    else:
        text = str(detail)

    lower = text.lower()
    if "scope" in lower:
        if "tracker:write" in lower:
            return f"{text}\n\n{WRITE_SCOPE_HINT}"
        if "tracker:read" in lower:
            return f"{text}\n\n{SCOPE_HINT}"
    return text
