from __future__ import annotations

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

# Conservative assumption until the Phase 0 audit records the real publication time of the bhavcopy.
BHAVCOPY_PUBLISHED_AFTER = time(19, 0)


def require_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("A timezone-aware datetime is required.")
    return value


def ist_datetime(day: date, at: time) -> datetime:
    return datetime.combine(day, at, tzinfo=IST)


def to_utc_naive(value: datetime) -> datetime:
    return require_aware(value).astimezone(timezone.utc).replace(tzinfo=None)


def from_utc_naive(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc)


def available_after(effective: date) -> datetime:
    """When data for this trading date may be treated as published (UTC-aware)."""
    return ist_datetime(effective, BHAVCOPY_PUBLISHED_AFTER).astimezone(timezone.utc)
