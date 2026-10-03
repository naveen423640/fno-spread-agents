from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from tests.support.bhavcopy_builder import make_fo_zip
from tests.support.synthetic_archive import last_thursday

# Per-ticker behaviour. "weight" is the liquidity key: tickers sharing a weight key have exactly identical traded values.
RICH_SPECS: list[dict] = [
    dict(ticker="BIGA", weight=9, lot=250, strikes=[900, 950, 1000, 1050, 1100], spot=1000, options=True, futures=True, extra=True),
    dict(ticker="MIDB", weight=4, lot=1200, strikes=[95, 97.5, 100, 102.5, 105], spot=100, options=True, futures=True, extra=False),
    dict(ticker="TIEA", weight=6, lot=500, strikes=[480, 490, 500, 510, 520], spot=500, options=True, futures=True, extra=True),
    dict(ticker="TIEB", weight=6, lot=500, strikes=[480, 490, 500, 510, 520], spot=500, options=True, futures=True, extra=True),
    dict(ticker="OPTO", weight=7, lot=75, strikes=[18000, 18500, 19000, 19500], spot=19000, options=True, futures=False, extra=True),
    dict(ticker="FUTO", weight=8, lot=300, strikes=[], spot=250, options=False, futures=True, extra=False),
    dict(ticker="ZLOT", weight=3, lot=40, strikes=[3000, 3100, 3200, 3300], spot=3200, options=True, futures=True, extra=False, zero_lot_rows=3, zero_strike_row=True),
    dict(ticker="SMAL", weight=1, lot=2000, strikes=[10, 11, 12, 13, 14, 15], spot=12.5, options=True, futures=True, extra=True),
]


def second_thursday(year: int, month: int) -> date:
    day = date(year, month, 1)
    while day.weekday() != 3:
        day += timedelta(days=1)
    return day + timedelta(days=7)


def _traded(spec: dict, day: date, base: int) -> str:
    # The factor cycles with the month so the ranking order changes between cycles; tickers sharing a weight key stay exactly tied.
    factor = 1 + (day.month + spec["weight"] * 3) % 5
    return f"{base * spec['weight'] * factor + 0.37:.2f}"


def _expiries(year: int, month: int, spec: dict, day: date) -> list[date]:
    found = [last_thursday(year, month)]
    if spec["extra"] and month % 2 == 0:
        found.append(second_thursday(year, month))
    return [e for e in found if e >= day]


def _rich_rows_for(day: date, specs: list[dict]) -> list[dict]:
    rows: list[dict] = []
    months = [(day.year, day.month), (day.year + (day.month == 12), day.month % 12 + 1)]
    for k, spec in enumerate(specs, start=1):
        ticker = spec["ticker"]
        for year, month in months:
            for expiry in _expiries(year, month, spec, day):
                stamp = expiry.strftime("%d%b%y").upper()
                if spec["options"]:
                    n = 0
                    for strike in spec["strikes"]:
                        for kind in ("CE", "PE"):
                            price = round(max(0.5, abs(spec["spot"] - strike) * 0.3 + 2.0 + k * 0.1), 2)
                            lot = 0 if n < spec.get("zero_lot_rows", 0) else spec["lot"]
                            n += 1
                            rows.append(dict(TradDt=day.isoformat(), FinInstrmTp="STO", TckrSymb=ticker, XpryDt=expiry.isoformat(), StrkPric=f"{strike:g}", OptnTp=kind,
                                             FinInstrmNm=f"{ticker}{stamp}{strike:g}{kind}", PrvsClsgPric=str(price), UndrlygPric=str(spec["spot"]), OpnPric=str(price),
                                             HghPric=str(price + 1), LwPric=str(max(0.1, price - 1)), ClsPric=str(price), SttlmPric=str(price), TtlTradgVol=str(100 * k),
                                             TtlTrfVal=_traded(spec, day, 1000 * (int(strike) % 7 + 1)), NewBrdLotQty=str(lot), OpnIntrst=str(1000 * k), ChngInOpnIntrst="10"))
                    if spec.get("zero_strike_row"):
                        rows.append(dict(TradDt=day.isoformat(), FinInstrmTp="STO", TckrSymb=ticker, XpryDt=expiry.isoformat(), StrkPric="0", OptnTp="CE",
                                         FinInstrmNm=f"{ticker}{stamp}0CE", PrvsClsgPric="1", UndrlygPric=str(spec["spot"]), OpnPric="1", HghPric="1", LwPric="1", ClsPric="1",
                                         SttlmPric="1", TtlTradgVol="1", TtlTrfVal=_traded(spec, day, 500), NewBrdLotQty=str(spec["lot"]), OpnIntrst="1", ChngInOpnIntrst="0"))
                if spec["futures"] and expiry == last_thursday(year, month):
                    rows.append(dict(TradDt=day.isoformat(), FinInstrmTp="STF", TckrSymb=ticker, XpryDt=expiry.isoformat(), StrkPric="0", OptnTp="", FinInstrmNm=f"{ticker}{stamp}FUT",
                                     PrvsClsgPric=str(spec["spot"]), UndrlygPric=str(spec["spot"]), OpnPric=str(spec["spot"]), HghPric=str(spec["spot"] + 1), LwPric=str(spec["spot"] - 1),
                                     ClsPric=str(spec["spot"]), SttlmPric=str(spec["spot"]), TtlTradgVol=str(1000 * k), TtlTrfVal=_traded(spec, day, 50_000),
                                     NewBrdLotQty=str(spec["lot"]), OpnIntrst=str(5000 * k), ChngInOpnIntrst="50"))
    return rows


def write_rich_synthetic_archive(root: Path, start: date, end: date, tickers: list[str] | None, holidays: set[date]) -> list[date]:
    """Writes root/fo/YYYYMMDD.zip for every weekday that is not a holiday, from RICH_SPECS (restricted to `tickers` when given).

    Differs from the homogeneous generator: several STO expiries in some months, a ticker with options but no futures and one with futures but no options,
    two ASCII tickers with exactly tied liquidity, varied lot sizes / strike grids / prices, and a ticker with zero-lot rows and a zero-strike row."""
    specs = [s for s in RICH_SPECS if tickers is None or s["ticker"] in tickers]
    written, day = [], start
    (root / "fo").mkdir(parents=True, exist_ok=True)
    while day <= end:
        if day.weekday() < 5 and day not in holidays:
            (root / "fo" / f"{day.strftime('%Y%m%d')}.zip").write_bytes(make_fo_zip(_rich_rows_for(day, specs)))
            written.append(day)
        day += timedelta(days=1)
    return written
