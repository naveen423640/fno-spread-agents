from __future__ import annotations

import csv
import io
import math
import zipfile

from .rows import CmRow, FoRow


class ArchiveFormatError(ValueError):
    pass


def _number(value: str | None) -> float:
    try:
        parsed = float(value) if value not in (None, "") else 0.0
    except ValueError:
        return 0.0
    return parsed if math.isfinite(parsed) else 0.0


def _read_csv(data: bytes, label: str) -> tuple[list[str], list[list[str]]]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            name = next((n for n in archive.namelist() if n.lower().endswith(".csv")), None)
            if name is None:
                raise ArchiveFormatError(f"NSE {label} archive did not contain a CSV file.")
            text = archive.read(name).decode("utf-8-sig")
    except zipfile.BadZipFile as error:
        raise ArchiveFormatError(f"NSE {label} archive is not a valid zip file.") from error
    rows = [row for row in csv.reader(io.StringIO(text)) if row]
    if len(rows) < 2:
        raise ArchiveFormatError(f"NSE {label} CSV is empty.")
    return rows[0], rows[1:]


FO_REQUIRED = ["TradDt", "FinInstrmTp", "TckrSymb", "XpryDt", "StrkPric", "OptnTp", "FinInstrmNm", "PrvsClsgPric", "UndrlygPric",
               "OpnPric", "HghPric", "LwPric", "ClsPric", "TtlTradgVol", "TtlTrfVal", "NewBrdLotQty", "OpnIntrst", "ChngInOpnIntrst"]


def parse_fo_bhavcopy_zip(data: bytes) -> list[FoRow]:
    header, body = _read_csv(data, "F&O")
    index = {name: i for i, name in enumerate(header)}
    for column in FO_REQUIRED:
        if column not in index:
            raise ArchiveFormatError(f"NSE F&O CSV is missing {column}.")
    settle = index.get("SttlmPric")
    rows: list[FoRow] = []
    for cells in body:
        if len(cells) < len(header) - 2:
            continue

        def at(name: str) -> str:
            return cells[index[name]] if index[name] < len(cells) else ""

        option_type = at("OptnTp")
        rows.append(FoRow(
            trading_date=at("TradDt"), instrument_type=at("FinInstrmTp"), ticker=at("TckrSymb"), expiry_date=at("XpryDt"),
            strike=_number(at("StrkPric")), option_type=option_type if option_type in ("CE", "PE") else "",
            instrument_name=at("FinInstrmNm"), open=_number(at("OpnPric")), high=_number(at("HghPric")), low=_number(at("LwPric")),
            close=_number(at("ClsPric")), previous_close=_number(at("PrvsClsgPric")), underlying_price=_number(at("UndrlygPric")),
            settle_price=_number(cells[settle]) if settle is not None and settle < len(cells) else 0.0,
            traded_volume=_number(at("TtlTradgVol")), traded_value=_number(at("TtlTrfVal")), lot_size=int(_number(at("NewBrdLotQty"))),
            open_interest=_number(at("OpnIntrst")), change_in_open_interest=_number(at("ChngInOpnIntrst")),
        ))
    if not rows:
        raise ArchiveFormatError("NSE F&O CSV had no usable rows.")
    return rows


def parse_cm_bhavcopy_zip(data: bytes) -> list[CmRow]:
    header, body = _read_csv(data, "cash")
    modern = "TckrSymb" in header
    names = {"ticker": ("TckrSymb", "SYMBOL"), "series": ("SctySrs", "SERIES"), "open": ("OpnPric", "OPEN"), "high": ("HghPric", "HIGH"),
             "low": ("LwPric", "LOW"), "close": ("ClsPric", "CLOSE"), "previous_close": ("PrvsClsgPric", "PREVCLOSE"),
             "traded_volume": ("TtlTradgVol", "TOTTRDQTY"), "traded_value": ("TtlTrfVal", "TOTTRDVAL")}
    index = {}
    for key, (new, old) in names.items():
        column = new if modern else old
        if column not in header:
            raise ArchiveFormatError(f"NSE cash CSV is missing {column}.")
        index[key] = header.index(column)
    rows = []
    for cells in body:
        if len(cells) <= max(index.values()) or not cells[index["ticker"]]:
            continue
        rows.append(CmRow(ticker=cells[index["ticker"]], series=cells[index["series"]], open=_number(cells[index["open"]]),
                          high=_number(cells[index["high"]]), low=_number(cells[index["low"]]), close=_number(cells[index["close"]]),
                          previous_close=_number(cells[index["previous_close"]]), traded_volume=_number(cells[index["traded_volume"]]),
                          traded_value=_number(cells[index["traded_value"]])))
    return rows
