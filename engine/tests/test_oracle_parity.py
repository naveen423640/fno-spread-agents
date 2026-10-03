import json
import os
import shutil
import subprocess
from datetime import date
from pathlib import Path

import pytest

from fnoengine.cycles import discover_completed_monthly_cycles, rank_historical_universe
from fnoengine.nse.parsers import parse_fo_bhavcopy_zip
from tests.support.rich_archive import write_rich_synthetic_archive
from tests.support.synthetic_archive import write_synthetic_archive

REPO = Path(__file__).resolve().parents[2]
TICKERS = [f"T{i}" for i in range(1, 9)]
TODAY = date(2026, 9, 30)


def run_oracle(archive: Path, out: Path, today: date, limit: int) -> dict:
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        pytest.skip("node/npx not available")
    env = {**os.environ, "ORACLE_ARCHIVE_DIR": str(archive), "ORACLE_OUT": str(out), "ORACLE_TODAY": today.isoformat(), "ORACLE_LIMIT": str(limit)}
    done = subprocess.run([npx, "vitest", "run", "tests/oracle/dump.oracle.test.ts"], cwd=REPO, env=env, capture_output=True, text=True, timeout=600)
    assert done.returncode == 0, done.stdout[-2000:] + done.stderr[-2000:]
    return json.loads(out.read_text(encoding="utf-8"))


def python_side(archive: Path, today: date, limit: int) -> dict:
    def report_on(day: date):
        path = archive / "fo" / f"{day.strftime('%Y%m%d')}.zip"
        return parse_fo_bhavcopy_zip(path.read_bytes()) if path.exists() else None

    cycles = discover_completed_monthly_cycles(report_on, today, 6)
    return {
        "cycles": [{"expiryDate": c.expiry_date, "firstEligibleTradingDay": c.first_eligible_trading_day, "entryTimestamp": c.entry_timestamp,
                    "previousTradingDay": c.previous_trading_day, "t1TradingDay": c.t1_trading_day} for c in cycles],
        "universe": {c.expiry_date: [{"ticker": r.ticker, "liquidityMetric": r.liquidity_metric, "lotSize": r.lot_size, "rank": r.rank,
                                      "contracts": [{"strike": k.strike, "optionType": k.option_type, "fyersSymbol": k.fyers_symbol} for k in r.contracts]}
                                     for r in rank_historical_universe(c, limit)] for c in cycles},
    }


def assert_same(mine: dict, oracle: dict) -> None:
    assert mine["cycles"] == oracle["cycles"]
    assert list(mine["universe"]) == list(oracle["universe"])
    for expiry, stocks in mine["universe"].items():
        theirs = oracle["universe"][expiry]
        assert [s["ticker"] for s in stocks] == [s["ticker"] for s in theirs], expiry
        for a, b in zip(stocks, theirs):
            assert a["rank"] == b["rank"] and a["lotSize"] == b["lotSize"] and a["contracts"] == b["contracts"]
            assert a["liquidityMetric"] == pytest.approx(b["liquidityMetric"], rel=1e-12)


@pytest.mark.parametrize("limit", [3, 50])
def test_python_matches_the_typescript_oracle_on_a_synthetic_archive(tmp_path, limit):
    holidays = {date(2026, 3, 3), date(2026, 5, 1), date(2026, 6, 2), date(2026, 8, 17)}
    write_synthetic_archive(tmp_path, date(2025, 11, 1), date(2026, 9, 30), TICKERS, holidays)
    oracle = run_oracle(tmp_path, tmp_path / "oracle.json", TODAY, limit)
    mine = python_side(tmp_path, TODAY, limit)
    assert_same(mine, oracle)


# Month-start runs (Mar 2-3, May 1, Jun 1-3), the day after an expiry (Jun 26, so that cycle's entry is not the first weekday), T-1 (Jul 29), interior (Aug 17).
RICH_HOLIDAYS = {date(2026, 3, 2), date(2026, 3, 3), date(2026, 5, 1), date(2026, 6, 1), date(2026, 6, 2), date(2026, 6, 3), date(2026, 6, 26), date(2026, 7, 29), date(2026, 8, 17)}


@pytest.mark.parametrize("limit", [3, 50])
def test_python_matches_the_typescript_oracle_on_a_rich_archive(tmp_path, limit):
    write_rich_synthetic_archive(tmp_path, date(2025, 11, 1), date(2026, 9, 30), None, RICH_HOLIDAYS)
    oracle = run_oracle(tmp_path, tmp_path / "oracle.json", TODAY, limit)
    mine = python_side(tmp_path, TODAY, limit)
    assert len(mine["cycles"]) == 6
    tickers = {s["ticker"] for stocks in mine["universe"].values() for s in stocks}
    assert "FUTO" not in tickers  # futures without options never enters the ranking
    if limit == 50:
        assert {"TIEA", "TIEB", "OPTO", "ZLOT"} <= tickers
    assert_same(mine, oracle)
