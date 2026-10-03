from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .calendar import TradingCalendar
from .incidents import IncidentLog
from .integrity import check_fo_rows
from .nse.archive import ArchiveError, NseArchiveClient
from .nse.parsers import ArchiveFormatError
from .store.store import Store


@dataclass
class IngestReport:
    inserted: list[date] = field(default_factory=list)
    unchanged: list[date] = field(default_factory=list)
    revised: list[date] = field(default_factory=list)
    gaps: list[date] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    fetch_failures: list[date] = field(default_factory=list)


def ingest_range(client: NseArchiveClient, store: Store, calendar: TradingCalendar, incidents: IncidentLog, start: date, end: date, now: datetime) -> IngestReport:
    report, day = IngestReport(), start
    while day <= end:
        if calendar.is_trading_day(day):
            try:
                fetched = client.fetch_fo(day)
            except (ArchiveError, OSError) as error:
                # Class name and message only: never a URL, query string or header.
                report.fetch_failures.append(day)
                incidents.record_once(f"DATA_FETCH_ERROR:{day.isoformat()}", f"Could not fetch F&O archive for {day.isoformat()}: {type(error).__name__}: {error}", now)
                day += timedelta(days=1)
                continue
            except ArchiveFormatError as error:
                detail = f"{day.isoformat()}: corrupt archive: {error}"
                report.errors.append(detail)
                incidents.record_once(f"INTEGRITY_ERROR:{day.isoformat()}", detail, now)
                day += timedelta(days=1)
                continue
            if fetched is None:
                report.gaps.append(day)
                incidents.record_once(f"DATA_GAP:{day.isoformat()}", f"No F&O archive for trading day {day.isoformat()}.", now)
            else:
                problems = [i for i in check_fo_rows(fetched.rows) if i.severity == "ERROR"]
                if problems:
                    detail = f"{day.isoformat()}: " + "; ".join(f"{p.code} {p.detail}" for p in problems[:5])
                    report.errors.append(detail)
                    incidents.record_once(f"INTEGRITY_ERROR:{day.isoformat()}", detail, now)
                else:
                    outcome = store.insert_fo(day, fetched.rows, sha256=fetched.sha256, size_bytes=fetched.size_bytes, retrieval_ts=fetched.retrieved_at, available_ts=fetched.available_at)
                    getattr(report, outcome).append(day)
                    # A day's problems are resolved only when that same day is stored.
                    for kind in ("DATA_GAP", "INTEGRITY_ERROR", "DATA_FETCH_ERROR"):
                        incidents.resolve(f"{kind}:{day.isoformat()}", now)
        day += timedelta(days=1)
    store.record_version(f"ingest {start.isoformat()}..{end.isoformat()}", now)
    return report


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Download NSE F&O daily archives into the local store (paper/data only).")
    parser.add_argument("--from", dest="start", required=True)
    parser.add_argument("--to", dest="end", required=True)
    parser.add_argument("--data-dir", default=str(Path(__file__).resolve().parents[2] / "data"))
    parser.add_argument("--holidays", default=str(Path(__file__).resolve().parents[3] / "reference" / "nse_holidays.json"))
    args = parser.parse_args(argv)
    from .safety import assert_paper_only

    assert_paper_only()
    data_dir = Path(args.data_dir)
    store = Store(data_dir / "fno.duckdb")
    calendar = TradingCalendar.from_file(args.holidays, require_verified=True)
    now = datetime.now(timezone.utc)
    report = ingest_range(NseArchiveClient(data_dir / "raw"), store, calendar, IncidentLog(store), date.fromisoformat(args.start), date.fromisoformat(args.end), now)
    print(f"inserted={len(report.inserted)} unchanged={len(report.unchanged)} revised={len(report.revised)} gaps={len(report.gaps)} errors={len(report.errors)} fetch_failures={len(report.fetch_failures)}")


if __name__ == "__main__":
    main()
