from datetime import date, datetime, timedelta, timezone

import pytest

from fnoengine.ist import available_after
from fnoengine.nse.parsers import parse_fo_bhavcopy_zip
from fnoengine.store.reader import PointInTimeReader
from fnoengine.store.store import Store
from tests.support.bhavcopy_builder import make_fo_zip
from tests.test_store import ROW


def make(tmp_path):
    store = Store(tmp_path / "t.duckdb")
    d = date(2026, 9, 29)
    rows = parse_fo_bhavcopy_zip(make_fo_zip([ROW]))
    store.insert_fo(d, rows, sha256="x", size_bytes=1, retrieval_ts=datetime(2026, 10, 3, tzinfo=timezone.utc), available_ts=available_after(d))
    return PointInTimeReader(store), d


def test_rows_are_invisible_before_they_are_available_and_visible_at_that_instant(tmp_path):
    reader, d = make(tmp_path)
    avail = available_after(d)
    assert reader.fo_rows(d, avail - timedelta(minutes=1)) is None
    assert reader.fo_rows(d, avail) is not None


def test_retrieval_time_does_not_make_data_available_earlier(tmp_path):
    # Retrieved on 3 Oct but published 29 Sep evening: a decision at noon on 29 Sep must not see it.
    reader, d = make(tmp_path)
    assert reader.fo_rows(d, datetime(2026, 9, 29, 6, 30, tzinfo=timezone.utc)) is None


def test_naive_as_of_is_rejected(tmp_path):
    reader, d = make(tmp_path)
    with pytest.raises(ValueError):
        reader.fo_rows(d, datetime(2026, 9, 30))


def test_available_dates_and_latest_respect_as_of(tmp_path):
    reader, d = make(tmp_path)
    before, after = datetime(2026, 9, 29, 6, 0, tzinfo=timezone.utc), datetime(2026, 9, 30, tzinfo=timezone.utc)
    assert reader.available_dates(before) == [] and reader.latest_available_date(before) is None
    assert reader.available_dates(after) == [d] and reader.latest_available_date(after) == d
