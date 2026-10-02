from datetime import date

import pytest

from fnoengine.cycles import discover_completed_monthly_cycles
from fnoengine.nse.parsers import parse_fo_bhavcopy_zip
from tests.support.synthetic_archive import last_thursday, write_synthetic_archive

TICKERS = ["T1", "T2", "T3"]
TODAY = date(2026, 9, 30)


@pytest.fixture(scope="module")
def archive(tmp_path_factory):
    root = tmp_path_factory.mktemp("archive")
    holidays = {date(2026, 3, 3), date(2026, 5, 1), date(2026, 8, 17)}  # arbitrary weekday holidays inside the range
    write_synthetic_archive(root, date(2025, 11, 1), date(2026, 9, 30), TICKERS, holidays)

    def report_on(day: date):
        path = root / "fo" / f"{day.strftime('%Y%m%d')}.zip"
        return parse_fo_bhavcopy_zip(path.read_bytes()) if path.exists() else None

    return report_on


def test_six_completed_cycles_newest_first(archive):
    # The September expiry (Thu 24 Sep) is before today (30 Sep), so it already counts as completed.
    cycles = discover_completed_monthly_cycles(archive, TODAY, 6)
    assert [c.expiry_date for c in cycles] == [last_thursday(2026, m).isoformat() for m in (9, 8, 7, 6, 5, 4)]


def test_cycle_boundaries_are_real_report_days_around_the_expiry(archive):
    cycle = discover_completed_monthly_cycles(archive, TODAY, 6)[0]
    assert cycle.t1_trading_day < cycle.expiry_date
    assert cycle.previous_trading_day < cycle.first_eligible_trading_day
    assert cycle.entry_timestamp == f"{cycle.first_eligible_trading_day}T09:20:00+05:30"
    assert cycle.ranking_rows, "the previous trading day's rows are kept for ranking"


def test_an_expiry_on_or_after_today_is_not_complete(archive):
    cycles = discover_completed_monthly_cycles(archive, date(2026, 8, 20), 3)
    assert all(c.expiry_date < "2026-08-20" for c in cycles)


def test_too_little_history_raises(archive):
    with pytest.raises(ValueError, match="completed monthly cycles"):
        discover_completed_monthly_cycles(archive, date(2025, 12, 15), 6)
