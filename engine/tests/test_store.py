from datetime import date, datetime, timedelta, timezone

from fnoengine.nse.parsers import parse_fo_bhavcopy_zip
from fnoengine.store.store import Store
from tests.support.bhavcopy_builder import make_fo_zip

ROW = dict(TradDt="2026-09-29", FinInstrmTp="STO", TckrSymb="SBIN", XpryDt="2026-09-29", StrkPric="980", OptnTp="CE", FinInstrmNm="SBIN26SEP980CE",
           PrvsClsgPric="1", UndrlygPric="985", OpnPric="1", HghPric="2", LwPric="1", ClsPric="1.5", TtlTradgVol="10", TtlTrfVal="15", NewBrdLotQty="750", OpnIntrst="100", ChngInOpnIntrst="5")
RET = datetime(2026, 9, 30, 1, 0, tzinfo=timezone.utc)
AV = datetime(2026, 9, 29, 13, 30, tzinfo=timezone.utc)


def rows(*names):
    return parse_fo_bhavcopy_zip(make_fo_zip([dict(ROW, FinInstrmNm=n) for n in names]))


def put(store, day, parsed, sha):
    return store.insert_fo(day, parsed, sha256=sha, size_bytes=10, retrieval_ts=RET, available_ts=AV)


def test_insert_unchanged_and_revised(tmp_path):
    store = Store(tmp_path / "t.duckdb")
    d = date(2026, 9, 29)
    assert put(store, d, rows("A", "B"), "aaa") == "inserted"
    assert put(store, d, rows("A", "B"), "aaa") == "unchanged"
    assert put(store, d, rows("A", "B", "C"), "bbb") == "revised"
    assert store.fo_dates() == [d]
    assert store.conn.execute("SELECT count(*) FROM fo_daily").fetchone()[0] == 5  # superseded rows are kept, not deleted
    assert store.conn.execute("SELECT revision, count(*) FROM fo_daily GROUP BY revision ORDER BY revision").fetchall() == [(0, 2), (1, 3)]
    history = store.conn.execute("SELECT sha256, is_current FROM ingest_files ORDER BY retrieval_ts, sha256").fetchall()
    assert sorted(history) == [("aaa", False), ("bbb", True)]  # the revision is recorded, not silently overwritten


def test_version_hash_is_stable_for_the_same_data_and_changes_on_revision(tmp_path):
    store = Store(tmp_path / "t.duckdb")
    d = date(2026, 9, 29)
    put(store, d, rows("A"), "aaa")
    v1 = store.record_version("first", RET)
    assert store.record_version("again", RET) == v1
    put(store, d, rows("A", "B"), "bbb")
    assert store.record_version("after revision", RET) != v1
    assert len(store.versions()) == 3


def test_survives_reopen(tmp_path):
    path = tmp_path / "t.duckdb"
    store = Store(path)
    put(store, date(2026, 9, 29), rows("A"), "aaa")
    store.close()
    assert Store(path).fo_dates() == [date(2026, 9, 29)]


def test_rows_round_trip_in_file_order_with_every_field(tmp_path):
    from fnoengine.ist import available_after
    from fnoengine.store.reader import PointInTimeReader
    store = Store(tmp_path / "t.duckdb")
    d = date(2026, 9, 29)
    original = rows("B", "A", "C")
    store.insert_fo(d, original, sha256="s", size_bytes=1, retrieval_ts=RET, available_ts=available_after(d))
    back = PointInTimeReader(store).fo_rows(d, datetime(2026, 9, 30, tzinfo=timezone.utc))
    assert back == original


R1 = datetime(2026, 10, 2, 0, 0, tzinfo=timezone.utc)


def revise(store, day, parsed, sha, retrieval, available):
    return store.insert_fo(day, parsed, sha256=sha, size_bytes=10, retrieval_ts=retrieval, available_ts=available)


def test_original_stays_visible_until_the_revision_was_first_seen(tmp_path):
    from fnoengine.store.reader import PointInTimeReader
    store = Store(tmp_path / "t.duckdb")
    d = date(2026, 9, 29)
    put(store, d, rows("A", "B"), "aaa")
    assert revise(store, d, rows("A", "B", "C"), "bbb", R1, AV) == "revised"
    reader = PointInTimeReader(store)
    assert len(reader.fo_rows(d, datetime(2026, 10, 1, tzinfo=timezone.utc))) == 2
    assert len(reader.fo_rows(d, R1)) == 3


def test_revision_available_ts_is_never_earlier_than_its_retrieval(tmp_path):
    from fnoengine.store.reader import PointInTimeReader
    store = Store(tmp_path / "t.duckdb")
    d = date(2026, 9, 29)
    put(store, d, rows("A"), "aaa")
    revise(store, d, rows("A", "B"), "bbb", R1, AV - timedelta(days=5))
    reader = PointInTimeReader(store)
    assert len(reader.fo_rows(d, R1 - timedelta(minutes=1))) == 1
    assert len(reader.fo_rows(d, R1)) == 2
    assert store.conn.execute("SELECT available_ts FROM ingest_files WHERE sha256='bbb'").fetchone()[0] == R1.replace(tzinfo=None)


def test_reingesting_original_content_after_a_revision_is_revision_two(tmp_path):
    from fnoengine.store.reader import PointInTimeReader
    store = Store(tmp_path / "t.duckdb")
    d = date(2026, 9, 29)
    put(store, d, rows("A", "B"), "aaa")
    revise(store, d, rows("A", "B", "C"), "bbb", R1, AV)
    later = R1 + timedelta(days=1)
    assert revise(store, d, rows("A", "B"), "aaa", later, AV) == "revised"
    assert store.conn.execute("SELECT max(revision) FROM fo_daily").fetchone()[0] == 2
    assert len(PointInTimeReader(store).fo_rows(d, later)) == 2
    assert store.conn.execute("SELECT count(*) FROM ingest_files WHERE is_current").fetchone()[0] == 1
