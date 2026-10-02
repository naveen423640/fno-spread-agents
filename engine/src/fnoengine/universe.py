from __future__ import annotations

from dataclasses import dataclass

from .nse.rows import FoRow


@dataclass(frozen=True)
class UniverseEntry:
    ticker: str
    lot_size: int


def fno_universe_on(rows: list[FoRow]) -> list[UniverseEntry]:
    """Stocks that have both stock futures and stock options in the day's report, with the lot size of their earliest futures expiry."""
    futures: dict[str, tuple[str, int]] = {}
    options: set[str] = set()
    for row in rows:
        if row.instrument_type == "STF" and row.lot_size > 0:
            best = futures.get(row.ticker)
            if best is None or row.expiry_date < best[0]:
                futures[row.ticker] = (row.expiry_date, row.lot_size)
        elif row.instrument_type == "STO":
            options.add(row.ticker)
    return sorted((UniverseEntry(t, lot) for t, (_, lot) in futures.items() if t in options), key=lambda e: e.ticker)
