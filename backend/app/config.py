import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_ROOT / ".env")
load_dotenv(_ROOT / "backend" / ".env")


@dataclass(frozen=True)
class Settings:
    tracker_token: str
    org_id: str
    org_header: str
    board_id: int
    tracker_base_url: str
    oauth_client_id: str
    oauth_client_secret: str
    oauth_redirect_uri: str
    oauth_scope: str
    sprint_tag_prefix: str
    extra_worklog_logins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.getenv("TRACKER_OAUTH_TOKEN", "").strip()
        org_id = os.getenv("TRACKER_ORG_ID", "").strip()
        org_header = os.getenv("TRACKER_ORG_HEADER", "X-Org-ID").strip() or "X-Org-ID"
        board_id = int(os.getenv("TRACKER_BOARD_ID", "288"))
        base_url = os.getenv("TRACKER_API_URL", "https://api.tracker.yandex.net").rstrip("/")
        client_id = os.getenv("TRACKER_OAUTH_CLIENT_ID", "").strip()
        client_secret = os.getenv("TRACKER_OAUTH_CLIENT_SECRET", "").strip()
        redirect_uri = os.getenv(
            "TRACKER_OAUTH_REDIRECT_URI",
            "https://oauth.yandex.ru/verification_code",
        ).strip()
        oauth_scope = os.getenv("TRACKER_OAUTH_SCOPE", "tracker:read tracker:write").strip() or "tracker:read tracker:write"
        sprint_tag_prefix = os.getenv("TRACKER_SPRINT_TAG_PREFIX", "").strip()
        extra_raw = os.getenv("TRACKER_EXTRA_WORKLOG_LOGINS", "")
        extra_worklog_logins = tuple(
            login.strip() for login in extra_raw.split(",") if login.strip()
        )
        return cls(
            tracker_token=token,
            org_id=org_id,
            org_header=org_header,
            board_id=board_id,
            tracker_base_url=base_url,
            oauth_client_id=client_id,
            oauth_client_secret=client_secret,
            oauth_redirect_uri=redirect_uri,
            oauth_scope=oauth_scope,
            sprint_tag_prefix=sprint_tag_prefix,
            extra_worklog_logins=extra_worklog_logins,
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.tracker_token and self.org_id)


settings = Settings.from_env()


def env_snapshot() -> Settings:
    """Актуальные значения из .env (uvicorn --reload не перечитывает файл)."""
    load_dotenv(_ROOT / ".env", override=True)
    load_dotenv(_ROOT / "backend" / ".env", override=True)
    return Settings.from_env()
