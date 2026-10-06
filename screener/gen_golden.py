#!/usr/bin/env python3
"""Generate tests/fixtures/screener/golden.json by running the reference implementation untouched.

Usage (from the repo root):  python screener/gen_golden.py
Needs pandas and numpy. The reference module and its parameter dict P are imported as they are; nothing here
changes the rules. The TypeScript port in lib/screener/* must reproduce every number written below.

Inputs are rounded to 4 decimals (volumes to integers) BEFORE anything is computed, so the JSON holds exactly the
numbers both implementations see.
"""
import contextlib
import io
import json
import math
import os
import sys
import tempfile
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import fo_spread_screener as ref  # noqa: E402

N_STOCKS, N_ROWS, SEED = 8, 800, 7
OUT = ROOT / "tests" / "fixtures" / "screener" / "golden.json"


def clean(x):
    if isinstance(x, (np.floating, float)):
        return None if (math.isnan(x) or math.isinf(x)) else float(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    if isinstance(x, pd.Timestamp):
        return x.strftime("%Y-%m-%d")
    if isinstance(x, dict):
        return {str(k): clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    return x


def rounded_data():
    raw = ref.synthetic(N_STOCKS, N_ROWS, SEED)
    out = {}
    for s, df in raw.items():
        d = df.copy()
        for c in ("Open", "High", "Low", "Close"):
            d[c] = d[c].round(4)
        d["Volume"] = d["Volume"].round(0)
        out[s] = d
    return out


def series(df):
    return {"dates": [t.strftime("%Y-%m-%d") for t in df.index],
            "o": [float(v) for v in df.Open], "h": [float(v) for v in df.High], "l": [float(v) for v in df.Low],
            "c": [float(v) for v in df.Close], "v": [float(v) for v in df.Volume]}


def trade_rows(t):
    rows = []
    for _, r in t.iterrows():
        rows.append(dict(sym=r["sym"], entry=r["entry"], days=int(r["days"]), why=r["why"], R=r["R"], risk_pct_spot=r["risk_pct_spot"]))
    return clean(rows)


def scan_rows(data, fixed_order):
    """Rows exactly as run_scan builds them, optionally ordered SIGNAL-first (the port's Decision 3)."""
    bench = data["^NSEI"]
    rows = []
    for s, df in data.items():
        if s == "^NSEI" or len(df) < 260:
            continue
        d = ref.add_indicators(df, bench)
        last = d.iloc[-1]
        for side, parts in ((+1, ref.parts_bull), (-1, ref.parts_bear)):
            t, r, p, g, v = [x.iloc[-1] for x in parts(d)]
            if not (t and r):
                continue
            status = "SIGNAL" if (p and g and v) else ("WATCH" if p and v else None)
            if not status:
                continue
            em = float(np.clip(last.hv20 * 1.1, 0.15, 0.9)) * math.sqrt(25 / 252)
            st = ref.nice_step(last.Close)
            rows.append(dict(symbol=s, sector=ref.UNIVERSE.get(s, ""), side="BULL CALL" if side > 0 else "BEAR PUT",
                             status=status, close=round(last.Close, 1), rsi=round(last.rsi, 1),
                             rs63_pct=round(last.rs63 * 100, 1), vol_x=round(last.vol_ratio, 2),
                             hv_pctile=round(last.hv_pct, 2),
                             long_strike_approx=round(last.Close / st) * st,
                             short_strike_approx=round(last.Close * (1 + side * em) / st) * st))
    if not rows:
        return [], []
    df = pd.DataFrame(rows)
    df["abs_rs"] = df.rs63_pct.abs()
    if fixed_order:
        df["rank"] = df.status.map({"SIGNAL": 0, "WATCH": 1})
        df = df.sort_values(["rank", "abs_rs"], ascending=[True, False], kind="stable")
    else:
        df["status"] = df.status.map({"SIGNAL": "SIGNAL", "WATCH": "WATCH: needs trigger"})
        df = df.sort_values(["status", "abs_rs"], ascending=[False, False], kind="stable")
    picked, count = [], {}
    for _, r in df.iterrows():
        k = (r.sector, r.side)
        if count.get(k, 0) >= 2:
            continue
        count[k] = count.get(k, 0) + 1
        picked.append(r)
    out = pd.DataFrame(picked)
    out["status"] = out["status"].replace({"WATCH: needs trigger": "WATCH"})
    return clean(rows), clean(out.drop(columns=[c for c in ("abs_rs", "rank") if c in out.columns]).to_dict("records"))


def main():
    data = rounded_data()
    bench = data["^NSEI"]
    ind = {s: ref.add_indicators(df, bench) for s, df in data.items() if s != "^NSEI"}
    names = list(ind)

    golden = {"universe": dict(ref.UNIVERSE), "params": clean(ref.P), "n_stocks": N_STOCKS, "n_rows": N_ROWS, "seed": SEED,
              "data": {s: series(df) for s, df in data.items()}}

    cols = ["sma20", "sma50", "sma200", "rsi", "rs63", "vol_ratio", "hv20", "hv_pct", "prev_high", "prev_low"]
    # Indicator arrays are stored at a sample of indices (warm-up rows, the 200-row boundary, then every 5th row).
    idx = sorted(set(range(0, 30)) | set(range(195, 215)) | set(range(255, N_ROWS, 5)) | {N_ROWS - 1})
    golden["indicator_index"] = idx
    golden["indicators"] = {s: {c: clean([ind[s][c].iloc[i] for i in idx]) for c in cols} for s in names[:2]}

    masks = {}
    for vname, (side, fn) in ref.VARIANTS.items():
        masks[vname] = {s: [int(i) for i in np.where(fn(ind[s]).fillna(False).values)[0]] for s in names}
    golden["masks"] = masks

    sims = []
    for vname, (side, fn) in ref.VARIANTS.items():
        for s in names:
            for i in [i for i in masks[vname][s] if i >= 260][:5]:
                sims.append(dict(variant=vname, sym=s, i=i, side=side, result=clean(ref.simulate(ind[s], i, side))))
    golden["simulate"] = sims

    bt = {}
    for vname, t in ref.backtest(data):
        entry = dict(trades=trade_rows(t) if not t.empty else [], stats=clean(ref.stats(t)))
        if not t.empty:
            mid = t.entry.sort_values().iloc[len(t) // 2]
            entry["first_half"] = clean(ref.stats(t[t.entry < mid]))
            entry["second_half"] = clean(ref.stats(t[t.entry >= mid]))
        bt[vname] = entry
    golden["backtest"] = bt

    # run_scan itself must agree with the row logic copied above (reference order)
    with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
        cwd = os.getcwd()
        os.chdir(tmp)
        try:
            ref.run_scan(data, 100, "yahoo")
            shortlist = pd.read_csv("shortlist.csv") if os.path.exists("shortlist.csv") else pd.DataFrame()
        finally:
            os.chdir(cwd)
    _, ref_order = scan_rows(data, fixed_order=False)
    ref_syms = [(r["symbol"], r["side"]) for r in ref_order]
    shortlist_syms = [(r.symbol, r.side) for r in shortlist.itertuples()] if len(shortlist) else []
    assert ref_syms == shortlist_syms, f"copied scan logic differs from run_scan: {ref_syms} vs {shortlist_syms}"

    scans = []
    # Scan at regular points and at every index where a full-rule variant fires, so SIGNAL rows are covered.
    fire = {i + 1 for v in ("bull_full", "bear_full") for lst in masks[v].values() for i in lst if i >= 260}
    ends = sorted({N_ROWS - 1} | set(range(300, N_ROWS, 20)) | {e for e in fire if e < N_ROWS})
    for end in ends:
        cut = {s: df.iloc[: end + 1] for s, df in data.items()}
        raw, fixed = scan_rows(cut, fixed_order=True)
        _, refo = scan_rows(cut, fixed_order=False)
        scans.append(dict(end=end, raw=raw, fixed_order=fixed, reference_order=refo))
    golden["scans"] = scans

    cases = [dt.date(2026, 10, 6), dt.date(2026, 10, 27), dt.date(2026, 10, 28), dt.date(2026, 12, 1), dt.date(2026, 12, 29),
             dt.date(2026, 12, 30), dt.date(2027, 1, 1), dt.date(2026, 2, 28), dt.date(2028, 2, 29), dt.date(2026, 6, 30)]
    golden["expiry"] = [dict(today=d.isoformat(), expiry=ref.monthly_expiry(d).isoformat()) for d in cases]
    golden["fy_opt"] = [dict(sym=s, yy=y, mon=m, strike=k, cp=cp, out=ref.fy_opt(s, y, m, k, cp))
                        for s, y, m, k, cp in (("RELIANCE", 26, "OCT", 1200, "PE"), ("HAL", 26, "oct", 4800.0, "ce"), ("M&M", 26, "NOV", 3250.5, "CE"),
                                               ("BAJAJ-AUTO", 27, "JAN", 9000, "PE"), ("DMART", 26, "DEC", 4100, "CE"))]
    golden["bs"] = [dict(S=S, K=K, T=T, sig=sig, call=c, out=ref.bs(S, K, T, sig, c))
                    for S, K, T, sig, c in ((100, 100, 0.08, 0.25, True), (100, 105, 0.08, 0.25, True), (100, 95, 0.08, 0.25, False),
                                            (250, 250, 20 / 252, 0.4, True), (250, 260, 1e-6, 0.4, True), (80, 90, 0.0, 0.3, False), (80, 70, 0.0, 0.3, False))]
    golden["nice_step"] = [dict(p=p, out=ref.nice_step(p)) for p in (50, 199.9, 200, 999, 1000, 1999, 2000, 4999, 5000, 80000)]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(clean(golden), separators=(",", ":")), encoding="utf-8")

    n_trades = {v: len(b["trades"]) for v, b in bt.items()}
    n_sig = sum(1 for s in scans for r in s["raw"] if r["status"] == "SIGNAL")
    n_watch = sum(1 for s in scans for r in s["raw"] if r["status"] == "WATCH")
    sides = {r["side"] for s in scans for r in s["raw"]}
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
    print("trades per variant:", n_trades)
    print(f"scan rows: SIGNAL {n_sig}, WATCH {n_watch}, sides {sorted(sides)}; simulate cases {len(sims)}")


if __name__ == "__main__":
    main()
