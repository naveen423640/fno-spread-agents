from dataclasses import replace

from fnoengine.integrity import check_fo_rows
from fnoengine.nse.parsers import parse_fo_bhavcopy_zip
from tests.support.bhavcopy_builder import make_fo_zip
from tests.test_store import ROW


def rows(**overrides):
    return parse_fo_bhavcopy_zip(make_fo_zip([dict(ROW, **overrides)]))


def codes(found):
    return {(i.severity, i.code) for i in found}


def test_clean_row_has_no_issues():
    assert check_fo_rows(rows()) == []


def test_high_below_low_and_close_outside_range_are_errors():
    assert ("ERROR", "HIGH_BELOW_LOW") in codes(check_fo_rows(rows(HghPric="1", LwPric="2")))
    assert ("ERROR", "CLOSE_OUTSIDE_RANGE") in codes(check_fo_rows(rows(ClsPric="9", HghPric="2", LwPric="1")))


def test_traded_contract_with_a_zero_close_is_an_error():
    assert ("ERROR", "TRADED_WITHOUT_PRICE") in codes(check_fo_rows(rows(ClsPric="0", TtlTradgVol="10")))


def test_missing_lot_size_and_duplicate_contract_names_are_errors():
    assert ("ERROR", "MISSING_LOT_SIZE") in codes(check_fo_rows(rows(NewBrdLotQty="0")))
    doubled = rows() + rows()
    assert ("ERROR", "DUPLICATE_CONTRACT") in codes(check_fo_rows(doubled))


def test_futures_with_volume_but_no_open_interest_anywhere_is_a_warning():
    futures = parse_fo_bhavcopy_zip(make_fo_zip([dict(ROW, FinInstrmTp="STF", OptnTp="", StrkPric="0", FinInstrmNm="SBIN26OCTFUT", OpnIntrst="0", ChngInOpnIntrst="0")]))
    assert ("WARN", "FUTURES_WITHOUT_OPEN_INTEREST") in codes(check_fo_rows(futures))


def test_expiry_before_the_trading_date_is_an_error():
    assert ("ERROR", "EXPIRED_CONTRACT") in codes(check_fo_rows(rows(XpryDt="2026-09-01")))


def test_trade_date_mismatch_is_an_error_only_when_an_effective_date_is_given():
    from datetime import date

    assert ("ERROR", "TRADE_DATE_MISMATCH") in codes(check_fo_rows(rows(), effective=date(2000, 1, 1)))
    assert all(c != "TRADE_DATE_MISMATCH" for _, c in codes(check_fo_rows(rows())))
