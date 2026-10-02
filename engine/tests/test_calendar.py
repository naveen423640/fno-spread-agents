import json
from datetime import date

import pytest

from fnoengine.calendar import CalendarNotVerified, TradingCalendar

CAL = TradingCalendar({date(2026, 9, 28)}, verified=True)  # pretend Mon 28 Sep is a holiday


def test_weekends_and_holidays_are_not_trading_days():
    assert not CAL.is_trading_day(date(2026, 9, 26)) and not CAL.is_trading_day(date(2026, 9, 28))
    assert CAL.is_trading_day(date(2026, 9, 29))


def test_previous_and_next_skip_non_trading_days():
    assert CAL.previous_trading_day(date(2026, 9, 29)) == date(2026, 9, 25)
    assert CAL.next_trading_day(date(2026, 9, 25)) == date(2026, 9, 29)


def test_add_trading_days_forward_and_back():
    assert CAL.add_trading_days(date(2026, 9, 25), 1) == date(2026, 9, 29)
    assert CAL.add_trading_days(date(2026, 9, 29), -1) == date(2026, 9, 25)
    assert CAL.add_trading_days(date(2026, 9, 29), 0) == date(2026, 9, 29)
    assert CAL.add_trading_days(date(2026, 9, 25), 3) == date(2026, 10, 1)


def test_trading_days_between_inclusive():
    assert CAL.trading_days(date(2026, 9, 25), date(2026, 9, 30)) == [date(2026, 9, 25), date(2026, 9, 29), date(2026, 9, 30)]


def test_cross_check_reports_both_kinds_of_disagreement():
    archives = {date(2026, 9, 25), date(2026, 9, 26), date(2026, 9, 30)}  # Sat has a file; Tue 29 is missing
    found = {(d.date, d.kind) for d in CAL.cross_check(archives, date(2026, 9, 25), date(2026, 9, 30))}
    assert found == {(date(2026, 9, 26), "archive_on_non_trading_day"), (date(2026, 9, 29), "trading_day_without_archive")}


def test_from_file_refuses_an_unverified_calendar_when_required(tmp_path):
    path = tmp_path / "h.json"
    path.write_text(json.dumps({"source": "x", "retrieved_on": "2026-10-03", "verified": False, "holidays": [{"date": "2026-01-26", "description": "Republic Day"}]}))
    assert TradingCalendar.from_file(path).is_trading_day(date(2026, 1, 26)) is False
    with pytest.raises(CalendarNotVerified):
        TradingCalendar.from_file(path, require_verified=True)


def test_the_repo_holiday_file_loads():
    from pathlib import Path
    cal = TradingCalendar.from_file(Path(__file__).resolve().parents[2] / "reference" / "nse_holidays.json")
    assert isinstance(cal, TradingCalendar)
