from __future__ import annotations

from datetime import date, datetime

from ..ist import require_aware, to_utc_naive
from ..nse.rows import FoRow
from .store import FO_COLUMNS, Store


class PointInTimeReader:
    """Every read takes an explicit as-of time and never returns data that was not yet available at that time."""

    def __init__(self, store: Store):
        self.store = store

    def fo_rows(self, effective: date, as_of: datetime) -> list[FoRow] | None:
        cutoff = to_utc_naive(require_aware(as_of))
        cursor = self.store.conn.execute(
            f"SELECT {', '.join(FO_COLUMNS[1:])} FROM fo_daily WHERE effective_date=? AND available_ts<=? ORDER BY row_number", [effective, cutoff])
        data = cursor.fetchall()
        if not data:
            return None
        return [FoRow(*row[:16], int(row[16]), row[17], row[18]) for row in data]

    def available_dates(self, as_of: datetime) -> list[date]:
        cutoff = to_utc_naive(require_aware(as_of))
        return [r[0] for r in self.store.conn.execute("SELECT DISTINCT effective_date FROM fo_daily WHERE available_ts<=? ORDER BY 1", [cutoff]).fetchall()]

    def latest_available_date(self, as_of: datetime) -> date | None:
        dates = self.available_dates(as_of)
        return dates[-1] if dates else None
