from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class FoRow:
    trading_date: str
    instrument_type: str
    ticker: str
    expiry_date: str
    strike: float
    option_type: str  # "CE", "PE" or ""
    instrument_name: str
    open: float
    high: float
    low: float
    close: float
    previous_close: float
    underlying_price: float
    settle_price: float
    traded_volume: float
    traded_value: float
    lot_size: int
    open_interest: float
    change_in_open_interest: float


@dataclass(frozen=True, slots=True)
class CmRow:
    ticker: str
    series: str
    open: float
    high: float
    low: float
    close: float
    previous_close: float
    traded_volume: float
    traded_value: float
