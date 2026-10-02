from __future__ import annotations

from dataclasses import dataclass

from .nse.rows import FoRow


@dataclass(frozen=True)
class IntegrityIssue:
    severity: str  # "ERROR" | "WARN"
    code: str
    detail: str


def check_fo_rows(rows: list[FoRow]) -> list[IntegrityIssue]:
    issues: list[IntegrityIssue] = []
    seen: set[str] = set()
    futures_with_volume = [r for r in rows if r.instrument_type == "STF" and r.traded_volume > 0]
    if futures_with_volume and all(r.open_interest == 0 and r.change_in_open_interest == 0 for r in futures_with_volume):
        issues.append(IntegrityIssue("WARN", "FUTURES_WITHOUT_OPEN_INTEREST", "No traded futures row carries open interest."))
    for row in rows:
        name = row.instrument_name
        if name in seen:
            issues.append(IntegrityIssue("ERROR", "DUPLICATE_CONTRACT", name))
        seen.add(name)
        if row.high < row.low:
            issues.append(IntegrityIssue("ERROR", "HIGH_BELOW_LOW", name))
        if row.traded_volume > 0 and not (row.low <= row.close <= row.high):
            issues.append(IntegrityIssue("ERROR", "CLOSE_OUTSIDE_RANGE", name))
        if row.traded_volume > 0 and row.close <= 0:
            issues.append(IntegrityIssue("ERROR", "TRADED_WITHOUT_PRICE", name))
        if row.instrument_type in ("STF", "STO") and row.lot_size <= 0:
            issues.append(IntegrityIssue("ERROR", "MISSING_LOT_SIZE", name))
        if row.instrument_type in ("STF", "STO") and row.expiry_date < row.trading_date:
            issues.append(IntegrityIssue("ERROR", "EXPIRED_CONTRACT", name))
    return issues
