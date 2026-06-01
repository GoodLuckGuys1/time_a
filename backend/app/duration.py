import re
from datetime import date, timedelta

# Yandex Tracker: 1 business day = 8h, 1 business week = 5 business days.
BUSINESS_DAY = timedelta(hours=8)
BUSINESS_WEEK = BUSINESS_DAY * 5

_ISO_RE = re.compile(
    r"^P"
    r"(?:(?P<years>\d+)Y)?"
    r"(?:(?P<months>\d+)M)?"
    r"(?:(?P<weeks>\d+)W)?"
    r"(?:(?P<days>\d+)D)?"
    r"(?:T"
    r"(?:(?P<hours>\d+)H)?"
    r"(?:(?P<minutes>\d+)M)?"
    r"(?:(?P<seconds>\d+)S)?"
    r")?$",
    re.IGNORECASE,
)


def parse_tracker_duration(duration: str) -> timedelta:
    """Parse ISO-8601 duration as used by Yandex Tracker worklogs."""
    if not duration:
        return timedelta(0)

    text = duration.strip().upper()
    match = _ISO_RE.match(text)
    if not match:
        return timedelta(0)

    groups = {k: int(v) if v else 0 for k, v in match.groupdict().items()}

    total = timedelta(0)
    if groups["weeks"]:
        total += BUSINESS_WEEK * groups["weeks"]
    if groups["days"]:
        total += BUSINESS_DAY * groups["days"]
    if groups["hours"] or groups["minutes"] or groups["seconds"]:
        total += timedelta(
            hours=groups["hours"],
            minutes=groups["minutes"],
            seconds=groups["seconds"],
        )
    # Calendar years/months are rare in worklogs; approximate for display only.
    if groups["years"]:
        total += timedelta(days=365 * groups["years"])
    if groups["months"]:
        total += timedelta(days=30 * groups["months"])

    return total


def minutes_to_tracker_duration(minutes: int) -> str:
    """ISO-8601 duration for Tracker worklog API (clock time, not business days)."""
    if minutes <= 0:
        return "PT0M"
    hours, mins = divmod(minutes, 60)
    if hours and mins:
        return f"PT{hours}H{mins}M"
    if hours:
        return f"PT{hours}H"
    return f"PT{mins}M"


def day_start_iso(day: date) -> str:
    """Default worklog start: noon Europe/Moscow."""
    return f"{day.isoformat()}T12:00:00.000+0300"


def format_duration(td: timedelta) -> str:
    total_minutes = int(td.total_seconds() // 60)
    hours, minutes = divmod(total_minutes, 60)
    if hours and minutes:
        return f"{hours}ч {minutes}м"
    if hours:
        return f"{hours}ч"
    return f"{minutes}м"
