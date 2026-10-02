from __future__ import annotations

import calendar
from datetime import date, timedelta
from pathlib import Path

from tests.support.bhavcopy_builder import make_fo_zip


def last_thursday(year: int, month: int) -> date:
    day = date(year, month, calendar.monthrange(year, month)[1])
    while day.weekday() != 3:
        day -= timedelta(days=1)
    return day


def _rows_for(day: date, tickers: list[str]) -> list[dict]:
    rows: list[dict] = []
    months = [(day.year, day.month), (day.year + (day.month == 12), day.month % 12 + 1)]
    for k, ticker in enumerate(tickers, start=1):
        for year, month in months:
            expiry = last_thursday(year, month)
            if expiry < day:
                continue
            stamp = expiry.strftime("%y%b").upper()
            lot = 100 * k
            for strike in (90, 95, 100, 105, 110):
                for kind in ("CE", "PE"):
                    price = max(0.5, abs(100 - strike) * 0.3 + 2.0 + k * 0.1)
                    rows.append(dict(TradDt=day.isoformat(), FinInstrmTp="STO", TckrSymb=ticker, XpryDt=expiry.isoformat(), StrkPric=str(strike), OptnTp=kind,
                                     FinInstrmNm=f"{ticker}{stamp}{strike}{kind}", PrvsClsgPric=str(price), UndrlygPric="100", OpnPric=str(price), HghPric=str(price + 1),
                                     LwPric=str(max(0.1, price - 1)), ClsPric=str(price), SttlmPric=str(price), TtlTradgVol=str(100 * k), TtlTrfVal=str(1000 * k * (strike % 7 + 1)),
                                     NewBrdLotQty=str(lot), OpnIntrst=str(1000 * k), ChngInOpnIntrst="10"))
            rows.append(dict(TradDt=day.isoformat(), FinInstrmTp="STF", TckrSymb=ticker, XpryDt=expiry.isoformat(), StrkPric="0", OptnTp="", FinInstrmNm=f"{ticker}{stamp}FUT",
                             PrvsClsgPric="100", UndrlygPric="100", OpnPric="100", HghPric="101", LwPric="99", ClsPric="100", SttlmPric="100", TtlTradgVol=str(1000 * k),
                             TtlTrfVal=str(50_000 * k), NewBrdLotQty=str(lot), OpnIntrst=str(5000 * k), ChngInOpnIntrst="50"))
    return rows


def write_synthetic_archive(root: Path, start: date, end: date, tickers: list[str], holidays: set[date]) -> list[date]:
    """Writes root/fo/YYYYMMDD.zip for every weekday that is not a holiday. Ticker k gets k times the traded value of ticker 1."""
    written, day = [], start
    (root / "fo").mkdir(parents=True, exist_ok=True)
    while day <= end:
        if day.weekday() < 5 and day not in holidays:
            (root / "fo" / f"{day.strftime('%Y%m%d')}.zip").write_bytes(make_fo_zip(_rows_for(day, tickers)))
            written.append(day)
        day += timedelta(days=1)
    return written
