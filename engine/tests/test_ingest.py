from datetime import date, datetime, timezone

from fnoengine.calendar import TradingCalendar
from fnoengine.incidents import IncidentLog
from fnoengine.ingest import ingest_range
from fnoengine.nse.archive import HttpResult, NseArchiveClient
from fnoengine.store.store import Store
from tests.support.bhavcopy_builder import make_fo_zip
from tests.test_store import ROW

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)
CAL = TradingCalendar({date(2026, 9, 28)}, verified=True)  # Mon 28 Sep is a holiday


def setup(tmp_path, responder):
    store = Store(tmp_path / "t.duckdb")
    client = NseArchiveClient(tmp_path / "cache", transport=lambda url, headers: responder(url), sleep=lambda s: None, clock=lambda: NOW)
    return store, client, IncidentLog(store)


def zip_for(day: date, **overrides) -> HttpResult:
    return HttpResult(200, make_fo_zip([dict(ROW, TradDt=day.isoformat(), **overrides)]))


def test_stores_published_days_and_records_a_gap_for_a_missing_trading_day(tmp_path):
    def responder(url):
        return HttpResult(404, b"") if "20260930" in url else zip_for(date(2026, 9, 29))

    store, client, incidents = setup(tmp_path, responder)
    report = ingest_range(client, store, CAL, incidents, date(2026, 9, 25), date(2026, 9, 30), NOW)
    assert report.inserted == [date(2026, 9, 25), date(2026, 9, 29)]
    assert report.gaps == [date(2026, 9, 30)]  # a trading day with no archive; the holiday and the weekend are not gaps
    assert [i["kind"] for i in incidents.open_incidents()] == ["DATA_GAP"]


def test_an_error_level_integrity_issue_is_not_stored(tmp_path):
    store, client, incidents = setup(tmp_path, lambda url: zip_for(date(2026, 9, 29), HghPric="1", LwPric="2"))
    report = ingest_range(client, store, CAL, incidents, date(2026, 9, 29), date(2026, 9, 29), NOW)
    assert report.inserted == [] and report.errors and store.fo_dates() == []
    assert any(i["kind"] == "INTEGRITY_ERROR" for i in incidents.open_incidents())


def test_rerunning_is_idempotent_and_never_duplicates_rows(tmp_path):
    store, client, incidents = setup(tmp_path, lambda url: zip_for(date(2026, 9, 29)))
    ingest_range(client, store, CAL, incidents, date(2026, 9, 29), date(2026, 9, 29), NOW)
    again = ingest_range(client, store, CAL, incidents, date(2026, 9, 29), date(2026, 9, 29), NOW)
    assert again.unchanged == [date(2026, 9, 29)] and again.inserted == []
    assert store.conn.execute("SELECT count(*) FROM fo_daily").fetchone()[0] == 1


def test_a_gap_incident_resolves_when_the_day_later_appears(tmp_path):
    state = {"published": False}
    store, client, incidents = setup(tmp_path, lambda url: zip_for(date(2026, 9, 29)) if state["published"] else HttpResult(404, b""))
    ingest_range(client, store, CAL, incidents, date(2026, 9, 29), date(2026, 9, 29), NOW)
    assert incidents.open_incidents()
    state["published"] = True
    ingest_range(client, store, CAL, incidents, date(2026, 9, 29), date(2026, 9, 29), NOW)
    assert incidents.open_incidents() == []


def _kinds(incidents):
    return [i["kind"] for i in incidents.open_incidents()]


def test_a_network_error_on_one_day_does_not_stop_the_run_and_resolves_later(tmp_path):
    state = {"fail": True}

    def responder(url):
        if "20260929" in url and state["fail"]:
            raise OSError("boom")
        return zip_for(date(2026, 9, 29))

    store, client, incidents = setup(tmp_path, responder)
    report = ingest_range(client, store, CAL, incidents, date(2026, 9, 25), date(2026, 9, 30), NOW)
    assert report.fetch_failures == [date(2026, 9, 29)]
    assert date(2026, 9, 25) in report.inserted and date(2026, 9, 29) not in report.inserted
    assert _kinds(incidents).count("DATA_FETCH_ERROR") == 1
    msg = [i["message"] for i in incidents.open_incidents() if i["kind"] == "DATA_FETCH_ERROR"][0]
    assert "2026-09-29" in msg and "OSError" in msg and "boom" in msg and "http" not in msg
    state["fail"] = False
    again = ingest_range(client, store, CAL, incidents, date(2026, 9, 25), date(2026, 9, 30), NOW)
    assert again.fetch_failures == [] and "DATA_FETCH_ERROR" not in _kinds(incidents)


def test_an_http_500_is_a_fetch_failure_not_a_crash(tmp_path):
    def responder(url):
        return HttpResult(500, b"") if "20260929" in url else zip_for(date(2026, 9, 25))

    store, client, incidents = setup(tmp_path, responder)
    report = ingest_range(client, store, CAL, incidents, date(2026, 9, 25), date(2026, 9, 29), NOW)
    assert report.fetch_failures == [date(2026, 9, 29)]
    assert report.inserted == [date(2026, 9, 25)]
    assert _kinds(incidents).count("DATA_FETCH_ERROR") == 1


def test_a_corrupt_archive_is_an_integrity_error_and_nothing_is_stored(tmp_path):
    store, client, incidents = setup(tmp_path, lambda url: HttpResult(200, b"not a zip"))
    report = ingest_range(client, store, CAL, incidents, date(2026, 9, 29), date(2026, 9, 29), NOW)
    assert report.errors and report.inserted == [] and store.fo_dates() == []
    assert "INTEGRITY_ERROR" in _kinds(incidents)
