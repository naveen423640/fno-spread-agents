from pathlib import Path

import pytest

from fnoengine.nse.parsers import ArchiveFormatError, parse_cm_bhavcopy_zip, parse_fo_bhavcopy_zip
from tests.support.bhavcopy_builder import FO_COLUMNS, make_cm_zip, make_fo_zip

REAL = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "real"

FUT = dict(TradDt="2026-09-29", FinInstrmTp="STF", TckrSymb="SBIN", XpryDt="2026-10-27", StrkPric="0", OptnTp="",
           FinInstrmNm="SBIN26OCTFUT", PrvsClsgPric="980", UndrlygPric="985", OpnPric="981", HghPric="990", LwPric="979",
           ClsPric="988", SttlmPric="988.5", TtlTradgVol="1000", TtlTrfVal="988000", NewBrdLotQty="750", OpnIntrst="5000", ChngInOpnIntrst="-200")
OPT = dict(FUT, FinInstrmTp="STO", XpryDt="2026-09-29", StrkPric="980", OptnTp="CE", FinInstrmNm="SBIN26SEP980CE", ClsPric="6.2")


def test_parses_futures_and_options_rows_with_open_interest():
    rows = parse_fo_bhavcopy_zip(make_fo_zip([FUT, OPT]))
    assert [r.instrument_type for r in rows] == ["STF", "STO"]
    fut = rows[0]
    assert (fut.ticker, fut.lot_size, fut.open_interest, fut.change_in_open_interest, fut.settle_price) == ("SBIN", 750, 5000.0, -200.0, 988.5)
    assert rows[1].option_type == "CE" and rows[1].strike == 980.0 and rows[1].close == 6.2


def test_preserves_file_order():
    names = ["A", "B", "C"]
    rows = parse_fo_bhavcopy_zip(make_fo_zip([dict(OPT, FinInstrmNm=n) for n in names]))
    assert [r.instrument_name for r in rows] == names


def test_missing_required_column_fails_loudly():
    header = [c for c in FO_COLUMNS if c != "ClsPric"]
    with pytest.raises(ArchiveFormatError, match="ClsPric"):
        parse_fo_bhavcopy_zip(make_fo_zip([OPT], header=header))


def test_missing_open_interest_column_is_an_error_not_zeros():
    header = [c for c in FO_COLUMNS if c not in ("OpnIntrst", "ChngInOpnIntrst")]
    with pytest.raises(ArchiveFormatError, match="OpnIntrst"):
        parse_fo_bhavcopy_zip(make_fo_zip([OPT], header=header))


def test_empty_archive_and_missing_csv_fail():
    with pytest.raises(ArchiveFormatError):
        parse_fo_bhavcopy_zip(make_fo_zip([]))
    import io, zipfile
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("readme.txt", "x")
    with pytest.raises(ArchiveFormatError):
        parse_fo_bhavcopy_zip(out.getvalue())


def test_non_numeric_cells_become_zero_like_the_typescript_parser():
    rows = parse_fo_bhavcopy_zip(make_fo_zip([dict(OPT, ClsPric="-", TtlTradgVol="")]))
    assert rows[0].close == 0.0 and rows[0].traded_volume == 0.0


def test_cash_parser_reads_modern_columns():
    rows = parse_cm_bhavcopy_zip(make_cm_zip([dict(TckrSymb="SBIN", SctySrs="EQ", OpnPric="980", HghPric="990", LwPric="975", ClsPric="987", PrvsClsgPric="979", TtlTradgVol="1000", TtlTrfVal="987000")]))
    assert (rows[0].ticker, rows[0].series, rows[0].close) == ("SBIN", "EQ", 987.0)


def test_cash_parser_reads_legacy_columns():
    legacy = ["SYMBOL", "SERIES", "OPEN", "HIGH", "LOW", "CLOSE", "PREVCLOSE", "TOTTRDQTY", "TOTTRDVAL"]
    rows = parse_cm_bhavcopy_zip(make_cm_zip([dict(SYMBOL="TCS", SERIES="EQ", OPEN="1", HIGH="2", LOW="0.5", CLOSE="1.5", PREVCLOSE="1", TOTTRDQTY="10", TOTTRDVAL="15")], header=legacy))
    assert (rows[0].ticker, rows[0].close) == ("TCS", 1.5)


def test_real_sample_parses_and_has_futures_open_interest():
    rows = parse_fo_bhavcopy_zip((REAL / "fo_bhavcopy_sample.zip").read_bytes())
    assert rows, "the real sample must contain rows"
    futures = [r for r in rows if r.instrument_type == "STF" and r.traded_volume > 0]
    assert futures and any(r.open_interest > 0 for r in futures)
    assert all(r.lot_size > 0 for r in rows if r.instrument_type in ("STF", "STO"))
