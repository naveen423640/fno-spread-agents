from datetime import date, datetime, time, timezone

import pytest

from fnoengine.ist import available_after, from_utc_naive, ist_datetime, to_utc_naive


def test_ist_round_trip_through_utc_naive():
    dt = ist_datetime(date(2026, 9, 29), time(19, 0))
    naive = to_utc_naive(dt)
    assert naive == datetime(2026, 9, 29, 13, 30)
    assert from_utc_naive(naive) == dt


def test_naive_input_is_rejected():
    with pytest.raises(ValueError):
        to_utc_naive(datetime(2026, 9, 29, 19, 0))


def test_available_after_is_evening_ist_of_the_effective_date():
    assert available_after(date(2026, 9, 29)) == datetime(2026, 9, 29, 17, 0, tzinfo=timezone.utc)
