from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from fnoengine.ist import available_after
from fnoengine.nse.archive import ArchiveError, HttpResult, NseArchiveClient
from tests.support.bhavcopy_builder import make_fo_zip

ROW = dict(TradDt="2026-09-29", FinInstrmTp="STO", TckrSymb="SBIN", XpryDt="2026-09-29", StrkPric="980", OptnTp="CE", FinInstrmNm="SBIN26SEP980CE",
           PrvsClsgPric="1", UndrlygPric="985", OpnPric="1", HghPric="2", LwPric="1", ClsPric="1.5", TtlTradgVol="10", TtlTrfVal="15", NewBrdLotQty="750", OpnIntrst="100", ChngInOpnIntrst="5")
NOW = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)


def client(tmp_path: Path, responses, sleeps=None):
    calls: list[str] = []

    def transport(url, headers):
        calls.append(url)
        result = responses.pop(0) if isinstance(responses, list) else responses(url)
        return result

    c = NseArchiveClient(tmp_path, transport=transport, sleep=(sleeps.append if sleeps is not None else (lambda s: None)), clock=lambda: NOW)
    return c, calls


def test_downloads_parses_and_records_provenance(tmp_path):
    c, calls = client(tmp_path, [HttpResult(200, make_fo_zip([ROW]))])
    report = c.fetch_fo(date(2026, 9, 29))
    assert report and len(report.rows) == 1 and report.from_cache is False
    assert report.retrieved_at == NOW and len(report.sha256) == 64
    assert "BhavCopy_NSE_FO_0_0_0_20260929_F_0000.csv.zip" in calls[0]
    assert report.available_at == available_after(date(2026, 9, 29))


def test_second_call_uses_the_cache_and_keeps_the_original_retrieval_time(tmp_path):
    c, calls = client(tmp_path, [HttpResult(200, make_fo_zip([ROW]))])
    first = c.fetch_fo(date(2026, 9, 29))
    c2 = NseArchiveClient(tmp_path, transport=lambda *_: (_ for _ in ()).throw(AssertionError("must not hit the network")), clock=lambda: datetime(2027, 1, 1, tzinfo=timezone.utc))
    second = c2.fetch_fo(date(2026, 9, 29))
    assert second.from_cache is True and second.retrieved_at == first.retrieved_at and second.sha256 == first.sha256
    assert len(calls) == 1


def test_weekend_makes_no_request(tmp_path):
    c, calls = client(tmp_path, [])
    assert c.fetch_fo(date(2026, 9, 26)) is None and calls == []


def test_404_means_no_report_and_is_not_cached(tmp_path):
    c, calls = client(tmp_path, [HttpResult(404, b""), HttpResult(200, make_fo_zip([ROW]))])
    assert c.fetch_fo(date(2026, 9, 29)) is None
    assert c.fetch_fo(date(2026, 9, 29)) is not None  # a later publication is picked up
    assert len(calls) == 2


def test_retries_transient_statuses_with_backoff_then_succeeds(tmp_path):
    sleeps: list[float] = []
    c, calls = client(tmp_path, [HttpResult(503, b""), HttpResult(429, b""), HttpResult(200, make_fo_zip([ROW]))], sleeps)
    assert c.fetch_fo(date(2026, 9, 29)) is not None
    assert len(calls) == 3 and sleeps == [0.25, 0.5]


def test_gives_up_after_three_transient_failures(tmp_path):
    c, _ = client(tmp_path, [HttpResult(503, b"")] * 3)
    with pytest.raises(ArchiveError, match="503"):
        c.fetch_fo(date(2026, 9, 29))


def test_other_errors_raise_and_a_corrupt_archive_is_never_cached(tmp_path):
    c, _ = client(tmp_path, [HttpResult(500, b"")])
    with pytest.raises(ArchiveError):
        c.fetch_fo(date(2026, 9, 29))
    c, _ = client(tmp_path, [HttpResult(200, b"not a zip")])
    with pytest.raises(Exception):
        c.fetch_fo(date(2026, 9, 29))
    assert not list((tmp_path / "fo").glob("*.zip")) if (tmp_path / "fo").exists() else True
