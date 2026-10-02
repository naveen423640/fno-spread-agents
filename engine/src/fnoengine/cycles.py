from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable

from .nse.rows import FoRow

ReportSource = Callable[[date], "list[FoRow] | None"]


@dataclass(frozen=True)
class CycleSnapshot:
    expiry_date: str
    first_eligible_trading_day: str
    entry_timestamp: str
    previous_trading_day: str
    t1_trading_day: str
    ranking_rows: tuple[FoRow, ...]


@dataclass(frozen=True)
class Contract:
    strike: float
    option_type: str
    fyers_symbol: str


@dataclass(frozen=True)
class RankedStock:
    ticker: str
    liquidity_metric: float
    lot_size: int | None
    contracts: tuple[Contract, ...]
    rank: int


def _first_report_between(report_on: ReportSource, start: date, end: date, descending: bool = False):
    days, day = [], start
    while day <= end:
        days.append(day)
        day += timedelta(days=1)
    if descending:
        days.reverse()
    for day in days:
        rows = report_on(day)
        if rows:
            return day, rows
    return None


def _expiry_for_month(report_on: ReportSource, year: int, month: int, today: date) -> str | None:
    month_end = date(year, month, calendar.monthrange(year, month)[1])
    probe_end = date(year, month, min(10, month_end.day))
    report = _first_report_between(report_on, date(year, month, 1), probe_end)
    if not report:
        return None
    prefix = f"{year:04d}-{month:02d}"
    expiries = sorted({r.expiry_date for r in report[1] if r.instrument_type == "STO" and r.option_type and r.expiry_date.startswith(prefix)})
    expiry = expiries[-1] if expiries else None
    if not expiry or expiry >= today.isoformat() or expiry > month_end.isoformat():
        return None
    return expiry


def discover_completed_monthly_cycles(report_on: ReportSource, today: date, count: int = 6) -> list[CycleSnapshot]:
    expiries: list[str] = []
    offset = 0
    while len(expiries) < count + 1 and offset < 18:
        total = today.year * 12 + (today.month - 1) - offset
        expiry = _expiry_for_month(report_on, total // 12, total % 12 + 1, today)
        if expiry:
            expiries.append(expiry)
        offset += 1
    if len(expiries) < count + 1:
        raise ValueError(f"Only {max(0, len(expiries) - 1)} completed monthly cycles could be reconstructed; {count} are required.")
    ordered = sorted(expiries)
    cycles: list[CycleSnapshot] = []
    for expiry in ordered[-count:]:
        previous_expiry = date.fromisoformat(ordered[ordered.index(expiry) - 1])
        expiry_day = date.fromisoformat(expiry)
        entry = _first_report_between(report_on, previous_expiry + timedelta(days=1), previous_expiry + timedelta(days=10))
        anchor = entry[0] if entry else previous_expiry
        previous = _first_report_between(report_on, anchor - timedelta(days=10), anchor - timedelta(days=1), True)
        t1 = _first_report_between(report_on, expiry_day - timedelta(days=10), expiry_day - timedelta(days=1), True)
        if not entry or not previous or not t1:
            raise ValueError(f"Trading-day boundaries could not be reconstructed for expiry {expiry}.")
        cycles.append(CycleSnapshot(expiry, entry[0].isoformat(), f"{entry[0].isoformat()}T09:20:00+05:30", previous[0].isoformat(), t1[0].isoformat(), tuple(previous[1])))
    return sorted(cycles, key=lambda c: c.expiry_date, reverse=True)


def rank_historical_universe(cycle: CycleSnapshot, limit: int = 50) -> list[RankedStock]:
    eligible: dict[str, list[FoRow]] = {}
    for row in cycle.ranking_rows:
        if row.instrument_type != "STO" or row.expiry_date != cycle.expiry_date or not row.option_type:
            continue
        eligible.setdefault(row.ticker, []).append(row)
    entries = []
    for ticker, option_rows in eligible.items():
        metric = sum(r.traded_value for r in cycle.ranking_rows if r.ticker == ticker)
        lot = next((r.lot_size for r in option_rows if r.lot_size > 0), None)
        contracts = tuple(Contract(r.strike, r.option_type, f"NSE:{r.instrument_name}") for r in option_rows if r.instrument_name and r.strike > 0)
        entries.append((ticker, metric, lot, contracts))
    entries.sort(key=lambda e: (-e[1], e[0]))
    return [RankedStock(t, m, lot, c, i + 1) for i, (t, m, lot, c) in enumerate(entries[:limit])]
