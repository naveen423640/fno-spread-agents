"""Usage: python scripts/trim_bhavcopy.py IN.zip OUT.zip TICKER [TICKER ...]
Keeps the header and only rows for the given tickers, so a real file can live in the repo as a small fixture."""
import csv
import io
import sys
import zipfile

source, target, *tickers = sys.argv[1:]
wanted = set(tickers)
with zipfile.ZipFile(source) as z:
    name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    text = z.read(name).decode("utf-8-sig")
rows = list(csv.reader(io.StringIO(text)))
header = rows[0]
column = "TckrSymb" if "TckrSymb" in header else "SYMBOL"
index = header.index(column)
kept = [header] + [r for r in rows[1:] if len(r) > index and r[index] in wanted]
buffer = io.StringIO()
csv.writer(buffer, lineterminator="\n").writerows(kept)
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr(name, buffer.getvalue())
print(f"kept {len(kept) - 1} rows for {sorted(wanted)}")
