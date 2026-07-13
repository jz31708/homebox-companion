from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta


def normalize_expiry(value: str | None) -> str | None:
    if not value or not value.strip():
        return None
    value = value.strip()
    if len(value) == 7 and value[4] == "-":
        year, month = value.split("-")
        if year.isdigit() and month.isdigit() and 1 <= int(month) <= 12:
            return value
    if len(value) == 10 and value[4] == "-" and value[7] == "-":
        date.fromisoformat(value)
        return value
    raise ValueError("Expiry must be YYYY-MM or YYYY-MM-DD")


def expiry_end(value: str) -> date:
    if len(value) == 7:
        year, month = (int(part) for part in value.split("-"))
        return date(year, month, monthrange(year, month)[1])
    return date.fromisoformat(value)


def classify_expiry(value: str | None, *, today: date | None = None) -> str:
    if not value:
        return "unknown"
    today = today or date.today()
    end = expiry_end(value)
    if end < today:
        return "expired"
    if end <= today + timedelta(days=90):
        return "expiring"
    return "current"
