from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path


class CalendarNotVerified(RuntimeError):
    pass


@dataclass(frozen=True)
class CalendarDiscrepancy:
    date: date
    kind: str  # "trading_day_without_archive" | "archive_on_non_trading_day"


class TradingCalendar:
    def __init__(self, holidays: set[date], verified: bool):
        self.holidays = frozenset(holidays)
        self.verified = verified

    @classmethod
    def from_file(cls, path: Path | str, require_verified: bool = False) -> "TradingCalendar":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if require_verified and not data.get("verified"):
            raise CalendarNotVerified(f"{path} is not marked verified; confirm it against the official NSE list first.")
        return cls({date.fromisoformat(h["date"]) for h in data["holidays"]}, bool(data.get("verified")))

    def is_trading_day(self, day: date) -> bool:
        return day.weekday() < 5 and day not in self.holidays

    def previous_trading_day(self, day: date) -> date:
        day -= timedelta(days=1)
        while not self.is_trading_day(day):
            day -= timedelta(days=1)
        return day

    def next_trading_day(self, day: date) -> date:
        day += timedelta(days=1)
        while not self.is_trading_day(day):
            day += timedelta(days=1)
        return day

    def add_trading_days(self, day: date, n: int) -> date:
        step = self.next_trading_day if n > 0 else self.previous_trading_day
        for _ in range(abs(n)):
            day = step(day)
        return day

    def trading_days(self, start: date, end: date) -> list[date]:
        days, day = [], start
        while day <= end:
            if self.is_trading_day(day):
                days.append(day)
            day += timedelta(days=1)
        return days

    def cross_check(self, archive_dates: set[date], start: date, end: date) -> list[CalendarDiscrepancy]:
        out: list[CalendarDiscrepancy] = []
        day = start
        while day <= end:
            trading, has_file = self.is_trading_day(day), day in archive_dates
            if trading and not has_file:
                out.append(CalendarDiscrepancy(day, "trading_day_without_archive"))
            elif has_file and not trading:
                out.append(CalendarDiscrepancy(day, "archive_on_non_trading_day"))
            day += timedelta(days=1)
        return out
