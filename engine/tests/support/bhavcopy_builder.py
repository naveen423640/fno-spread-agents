import csv
import io
import zipfile

FO_COLUMNS = ["TradDt", "FinInstrmTp", "TckrSymb", "XpryDt", "StrkPric", "OptnTp", "FinInstrmNm", "PrvsClsgPric",
              "UndrlygPric", "OpnPric", "HghPric", "LwPric", "ClsPric", "SttlmPric", "TtlTradgVol", "TtlTrfVal",
              "NewBrdLotQty", "OpnIntrst", "ChngInOpnIntrst"]
CM_COLUMNS = ["TckrSymb", "SctySrs", "OpnPric", "HghPric", "LwPric", "ClsPric", "PrvsClsgPric", "TtlTradgVol", "TtlTrfVal"]


def _zip(name: str, header: list[str], rows: list[list[str]]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(name, buffer.getvalue())
    return out.getvalue()


def make_fo_zip(rows: list[dict], header: list[str] | None = None) -> bytes:
    header = header or FO_COLUMNS
    return _zip("fo.csv", header, [[str(row.get(col, "")) for col in header] for row in rows])


def make_cm_zip(rows: list[dict], header: list[str] | None = None) -> bytes:
    header = header or CM_COLUMNS
    return _zip("cm.csv", header, [[str(row.get(col, "")) for col in header] for row in rows])
