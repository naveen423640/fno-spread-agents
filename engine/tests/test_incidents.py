from datetime import datetime, timezone

from fnoengine.incidents import IncidentLog
from fnoengine.store.store import Store

T1 = datetime(2026, 10, 3, 4, 0, tzinfo=timezone.utc)
T2 = datetime(2026, 10, 3, 5, 0, tzinfo=timezone.utc)


def test_records_once_until_resolved_then_again(tmp_path):
    log = IncidentLog(Store(tmp_path / "t.duckdb"))
    assert log.record_once("TOKEN_MISSING", "no token", T1) is True
    assert log.record_once("TOKEN_MISSING", "no token", T2) is False
    assert len(log.open_incidents()) == 1
    assert log.resolve("TOKEN_MISSING", T2) is True and log.open_incidents() == []
    assert log.resolve("TOKEN_MISSING", T2) is False
    assert log.record_once("TOKEN_MISSING", "no token again", T2) is True
    assert len(log.all()) == 2


def test_different_kinds_are_independent(tmp_path):
    log = IncidentLog(Store(tmp_path / "t.duckdb"))
    assert log.record_once("A", "x", T1) and log.record_once("B", "y", T1)
    assert len(log.open_incidents()) == 2
