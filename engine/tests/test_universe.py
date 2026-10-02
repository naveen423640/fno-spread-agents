from datetime import date

from fnoengine.cycles import discover_completed_monthly_cycles, rank_historical_universe
from fnoengine.nse.parsers import parse_fo_bhavcopy_zip
from fnoengine.universe import fno_universe_on
from tests.support.synthetic_archive import write_synthetic_archive

TICKERS = ["T1", "T2", "T3", "T4"]


def build(tmp_path):
    write_synthetic_archive(tmp_path, date(2025, 11, 1), date(2026, 9, 30), TICKERS, set())

    def report_on(day: date):
        path = tmp_path / "fo" / f"{day.strftime('%Y%m%d')}.zip"
        return parse_fo_bhavcopy_zip(path.read_bytes()) if path.exists() else None

    return report_on


def test_ranking_is_by_total_traded_value_descending_with_ticker_tiebreak(tmp_path):
    cycle = discover_completed_monthly_cycles(build(tmp_path), date(2026, 9, 30), 6)[0]
    ranked = rank_historical_universe(cycle, 3)
    assert [r.ticker for r in ranked] == ["T4", "T3", "T2"]
    assert [r.rank for r in ranked] == [1, 2, 3]
    assert ranked[0].liquidity_metric > ranked[1].liquidity_metric


def test_lot_size_and_contracts_come_from_the_archive_in_file_order(tmp_path):
    cycle = discover_completed_monthly_cycles(build(tmp_path), date(2026, 9, 30), 6)[0]
    top = rank_historical_universe(cycle, 1)[0]
    assert top.lot_size == 400
    assert top.contracts[0].fyers_symbol.startswith("NSE:T4")
    assert {c.option_type for c in top.contracts} == {"CE", "PE"}


def test_fno_universe_needs_both_futures_and_options_and_reports_lot_size(tmp_path):
    rows = build(tmp_path)(date(2026, 9, 29))
    universe = fno_universe_on(rows)
    assert [(u.ticker, u.lot_size) for u in universe] == [("T1", 100), ("T2", 200), ("T3", 300), ("T4", 400)]
    options_only = [r for r in rows if r.instrument_type == "STO"]
    futures_only = [r for r in rows if r.instrument_type == "STF"]
    assert fno_universe_on(options_only) == [] and fno_universe_on(futures_only) == []
