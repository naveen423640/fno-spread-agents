from datetime import date, datetime, timezone

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
    assert store.conn.execute("SELECT count(*) FROM fo_daily").fetchone()[0] == 3
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
