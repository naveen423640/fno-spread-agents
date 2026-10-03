from datetime import date, datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from fnoengine.api import create_app
from fnoengine.auth.token_store import TokenStore
from fnoengine.incidents import IncidentLog
from fnoengine.ist import available_after
from fnoengine.nse.parsers import parse_fo_bhavcopy_zip
from fnoengine.store.store import Store
from tests.support.synthetic_archive import _rows_for
from tests.support.bhavcopy_builder import make_fo_zip

REPO = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 9, 30, 6, 0, tzinfo=timezone.utc)  # Wed 11:30 IST: 29 Sep is published, 30 Sep is not yet


def build(tmp_path, with_token=True, incident=False):
    store = Store(tmp_path / "s.duckdb")
    for day in (date(2026, 9, 29), date(2026, 9, 30)):
        rows = parse_fo_bhavcopy_zip(make_fo_zip(_rows_for(day, ["T1", "T2"])))
        store.insert_fo(day, rows, sha256=day.isoformat(), size_bytes=1, retrieval_ts=NOW, available_ts=available_after(day))
    if incident:
        IncidentLog(store).record_once("DATA_GAP:2026-09-25", "No bhavcopy for 2026-09-25", NOW)
    tokens = TokenStore(tmp_path / "t.json", repo_root=REPO)
    if with_token:
        tokens.save("CLIENT", "SECRET-TOKEN-VALUE", NOW)
    return TestClient(create_app(store, tokens, now=lambda: NOW))


def test_health(tmp_path):
    assert build(tmp_path).get("/health").json()["status"] == "ok"


def test_universe_for_a_published_date_includes_lot_sizes(tmp_path):
    body = build(tmp_path).get("/universe/2026-09-29").json()
    assert body["date"] == "2026-09-29" and body["source"] == "engine"
    assert body["entries"] == [{"ticker": "T1", "lotSize": 100}, {"ticker": "T2", "lotSize": 200}]


def test_an_unpublished_date_is_not_served_even_though_it_is_stored(tmp_path):
    assert build(tmp_path).get("/universe/2026-09-30").status_code == 404


def test_latest_means_the_latest_published_date(tmp_path):
    assert build(tmp_path).get("/universe/latest").json()["date"] == "2026-09-29"


def test_bad_dates_are_rejected(tmp_path):
    assert build(tmp_path).get("/universe/2026-13-40").status_code == 400
    assert build(tmp_path).get("/universe/yesterday").status_code == 400


def test_token_status_never_reveals_the_token(tmp_path):
    response = build(tmp_path).get("/token/status")
    assert response.json()["status"] == "OK" and response.json()["allowEntries"] is True
    assert "SECRET-TOKEN-VALUE" not in response.text and "access_token" not in response.text


def test_no_endpoint_reveals_the_token_or_its_path(tmp_path):
    client = build(tmp_path, incident=True)
    for path in ("/health", "/token/status", "/incidents"):
        text = client.get(path).text
        assert "SECRET-TOKEN-VALUE" not in text and "access_token" not in text, path
        assert "t.json" not in text, path


def test_open_per_date_incident_is_listed(tmp_path):
    body = build(tmp_path, incident=True).get("/incidents").json()
    assert [(i["kind"], i["message"]) for i in body["open"]] == [("DATA_GAP:2026-09-25", "No bhavcopy for 2026-09-25")]
    assert len(body["all"]) == 1


def test_missing_token_reports_blocked_entries_but_the_api_stays_up(tmp_path):
    client = build(tmp_path, with_token=False)
    status = client.get("/token/status").json()
    assert status["status"] == "MISSING" and status["allowEntries"] is False
    assert client.get("/health").status_code == 200


def test_only_get_routes_exist(tmp_path):
    client = build(tmp_path)
    for route in client.app.routes:
        methods = getattr(route, "methods", None)
        if methods:
            assert methods <= {"GET", "HEAD"}, (route.path, methods)
    assert client.post("/health").status_code == 405
    assert client.delete("/incidents").status_code == 405


def test_serve_binds_localhost_only():
    import inspect

    from fnoengine import api
    assert '"127.0.0.1"' in inspect.getsource(api.serve)
