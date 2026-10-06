#!/usr/bin/env python3
"""
F&O trend-pullback debit-spread screener + backtest.

Setup:   pip install yfinance pandas numpy            (Yahoo data)
         pip install fyers-apiv3 pandas numpy          (Fyers data, optional)
Scan:    python fo_spread_screener.py scan [--source yahoo|fyers]
Backtest python fo_spread_screener.py backtest [--source yahoo|fyers]
Check:   python fo_spread_screener.py check --symbol HAL --side bull --long 4800 --short 5100 --expiry 26OCT
         (live option check on Fyers: bid/ask, debit vs width, breakeven, rupees per lot)
Dry run: python fo_spread_screener.py backtest --synthetic   (fake data, tests the code only)

Fyers auth: set env FYERS_APP_ID (e.g. ABCD1234-100) and FYERS_ACCESS_TOKEN (the access token
from your Fyers login flow; it expires daily). The script is read-only: it never places orders.
Always verify earnings/news dates before trading a shortlisted name.

Backtest note: it prices spreads with Black-Scholes using 1.1 x 20-day realised vol
as an IV proxy (no skew, no real option history). Treat results as indicative only.
"""
import argparse
import datetime as dt
import math
import os
import sys
import time

import numpy as np
import pandas as pd

# ---------------------------------------------------------------- universe
UNIVERSE = {
    "RELIANCE": "Energy", "ONGC": "Energy", "BPCL": "Energy", "IOC": "Energy", "COALINDIA": "Energy",
    "HDFCBANK": "Banks", "ICICIBANK": "Banks", "SBIN": "Banks", "AXISBANK": "Banks",
    "KOTAKBANK": "Banks", "INDUSINDBK": "Banks", "BANKBARODA": "Banks", "PNB": "Banks",
    "BAJFINANCE": "Fin", "BAJAJFINSV": "Fin", "SBILIFE": "Fin", "HDFCLIFE": "Fin",
    "CHOLAFIN": "Fin", "SHRIRAMFIN": "Fin",
    "TCS": "IT", "INFY": "IT", "HCLTECH": "IT", "WIPRO": "IT", "TECHM": "IT", "LTIM": "IT",
    "SUNPHARMA": "Pharma", "CIPLA": "Pharma", "DRREDDY": "Pharma", "DIVISLAB": "Pharma",
    "LUPIN": "Pharma", "ZYDUSLIFE": "Pharma", "AUROPHARMA": "Pharma",
    "APOLLOHOSP": "Hospitals", "MAXHEALTH": "Hospitals",
    "MARUTI": "Auto", "M&M": "Auto", "BAJAJ-AUTO": "Auto", "EICHERMOT": "Auto",
    "HEROMOTOCO": "Auto", "TVSMOTOR": "Auto",
    "HINDUNILVR": "FMCG", "ITC": "FMCG", "NESTLEIND": "FMCG", "BRITANNIA": "FMCG",
    "TATACONSUM": "FMCG", "DMART": "Retail", "TRENT": "Retail", "TITAN": "Consumer",
    "ASIANPAINT": "Consumer", "PIDILITIND": "Consumer",
    "LT": "Infra", "ADANIPORTS": "Infra", "ADANIENT": "Conglomerate",
    "ULTRACEMCO": "Cement", "GRASIM": "Cement", "AMBUJACEM": "Cement",
    "TATASTEEL": "Metals", "JSWSTEEL": "Metals", "HINDALCO": "Metals", "VEDL": "Metals",
    "JINDALSTEL": "Metals",
    "NTPC": "Power", "POWERGRID": "Power", "TATAPOWER": "Power",
    "BHARTIARTL": "Telecom", "HAL": "Defence", "BEL": "Defence",
}

# ---------------------------------------------------------------- rules (tune here)
P = dict(
    rsi_bull=(35, 48), rsi_bear=(52, 65),
    near_ma_up=1.01, near_ma_lo=0.97,
    hv_pct_max=0.60,          # skip when realised-vol percentile is high (IV proxy)
    hold_days=20, time_exit_left=8,   # enter ~4 weeks out, close ~8 trading days before expiry
    take_profit=0.60, stop_loss=0.50, slippage=0.02,
)


# ---------------------------------------------------------------- data
def load_yahoo(years=5, cache="cache"):
    import yfinance as yf
    os.makedirs(cache, exist_ok=True)
    out = {}
    syms = list(UNIVERSE) + ["^NSEI"]
    for s in syms:
        path = os.path.join(cache, s.replace("^", "") + ".csv")
        tk = s + ".NS" if s != "^NSEI" else s
        try:
            df = yf.Ticker(tk).history(period=f"{years}y", auto_adjust=True)
            if df.empty:
                raise ValueError("empty")
            df.to_csv(path)
        except Exception as e:
            if os.path.exists(path):
                df = pd.read_csv(path, index_col=0, parse_dates=True)
            else:
                print(f"skip {s}: {e}")
                continue
        df.index = pd.to_datetime(df.index, utc=True).tz_convert("Asia/Kolkata").tz_localize(None).normalize()
        out[s] = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    return out


# ---------------------------------------------------------------- Fyers
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def fy_sym(s):
    """Fyers equity/index symbol: NSE:RELIANCE-EQ, NSE:NIFTY50-INDEX."""
    return "NSE:NIFTY50-INDEX" if s == "^NSEI" else f"NSE:{s}-EQ"


def fy_opt(sym, yy, mon, strike, cp):
    """Fyers monthly stock option symbol, e.g. NSE:RELIANCE26OCT1200PE."""
    return f"NSE:{sym}{int(yy):02d}{mon.upper()}{strike:g}{cp.upper()}"


def monthly_expiry(today=None):
    """Last Tuesday of the month (current stock F&O monthly expiry); next month if already past."""
    today = today or dt.date.today()
    for add in (0, 1):
        y, m = today.year + (today.month - 1 + add) // 12, (today.month - 1 + add) % 12 + 1
        d = dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)
        while d.weekday() != 1:
            d -= dt.timedelta(days=1)
        if d >= today:
            return d
    return d


def fyers_client():
    try:
        from fyers_apiv3 import fyersModel
    except ImportError:
        sys.exit("pip install fyers-apiv3")
    app, tok = os.environ.get("FYERS_APP_ID"), os.environ.get("FYERS_ACCESS_TOKEN")
    if not app or not tok:
        sys.exit("Set FYERS_APP_ID (e.g. ABCD1234-100) and FYERS_ACCESS_TOKEN")
    return fyersModel.FyersModel(client_id=app, token=tok, is_async=False, log_path="")


def candles_to_df(rows):
    df = pd.DataFrame(rows, columns=["ts", "Open", "High", "Low", "Close", "Volume"])
    idx = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert("Asia/Kolkata").dt.tz_localize(None).dt.normalize()
    df.index = pd.DatetimeIndex(idx)
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df[["Open", "High", "Low", "Close", "Volume"]].dropna()


def load_fyers(years=5, cache="cache_fyers"):
    """Daily candles from Fyers. History calls are limited per request (~1 year for daily)
    and rate limited (~200/min), so fetch in chunks and throttle."""
    fy = fyers_client()
    os.makedirs(cache, exist_ok=True)
    end = dt.date.today()
    out = {}
    for s in list(UNIVERSE) + ["^NSEI"]:
        path = os.path.join(cache, s.replace("^", "") + ".csv")
        try:
            rows, cur = [], end - dt.timedelta(days=365 * years)
            while cur < end:
                nxt = min(cur + dt.timedelta(days=360), end)
                r = fy.history({"symbol": fy_sym(s), "resolution": "D", "date_format": "1",
                                "range_from": cur.strftime("%Y-%m-%d"),
                                "range_to": nxt.strftime("%Y-%m-%d"), "cont_flag": "1"})
                if r.get("s") != "ok":
                    raise ValueError(r.get("message", r))
                rows += r.get("candles", [])
                cur = nxt + dt.timedelta(days=1)
                time.sleep(0.4)
            df = candles_to_df(rows)
            if df.empty:
                raise ValueError("empty")
            df.to_csv(path)
        except Exception as e:
            if os.path.exists(path):
                df = pd.read_csv(path, index_col=0, parse_dates=True)
            else:
                print(f"skip {s}: {e}")
                continue
        out[s] = df
    return out


def fy_lot_size(ticker, cache="cache_fyers"):
    """Lot size from the Fyers symbol master (never hardcode lots; they change)."""
    import urllib.request
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, "NSE_FO.csv")
    if not os.path.exists(path) or time.time() - os.path.getmtime(path) > 86400:
        urllib.request.urlretrieve("https://public.fyers.in/sym_details/NSE_FO.csv", path)
    m = pd.read_csv(path, header=None, dtype=str)
    row = m[m[9] == ticker]
    if row.empty:
        raise ValueError(f"{ticker} not in symbol master")
    return int(row.iloc[0, 3])


def _best(side_list):
    return float(side_list[0]["price"]) if side_list else float("nan")


def live_check(sym, side, k_long, k_short, expiry):
    """Read-only live check of a debit spread on Fyers (bid/ask, debit vs width, rupees per lot)."""
    fy = fyers_client()
    yy, mon = expiry[:2], expiry[2:5]
    cp = "CE" if side > 0 else "PE"
    legs = {}
    for name, k in (("long", k_long), ("short", k_short)):
        tk = fy_opt(sym, yy, mon, k, cp)
        r = fy.depth({"symbol": tk, "ohlcv_flag": "1"})
        if r.get("s") != "ok" or tk not in r.get("d", {}):
            sys.exit(f"No quote for {tk}: {r}. Check strike/expiry exist on Fyers.")
        d = r["d"][tk]
        legs[name] = dict(symbol=tk, bid=_best(d.get("bids", [])), ask=_best(d.get("ask", [])),
                          ltp=d.get("ltp"), oi=d.get("oi"))
        time.sleep(0.2)
    lot = fy_lot_size(fy_opt(sym, yy, mon, k_long, cp))
    debit = legs["long"]["ask"] - legs["short"]["bid"]
    width = abs(k_short - k_long)
    be = k_long + debit if side > 0 else k_long - debit
    print(f"{legs['long']['symbol']}  bid {legs['long']['bid']} ask {legs['long']['ask']}  OI {legs['long']['oi']}")
    print(f"{legs['short']['symbol']}  bid {legs['short']['bid']} ask {legs['short']['ask']}  OI {legs['short']['oi']}")
    print(f"lot {lot} | debit (buy ask - sell bid) {debit:.2f} = {debit / width * 100:.0f}% of width {width}")
    print(f"max loss Rs {debit * lot:,.0f} | max profit Rs {(width - debit) * lot:,.0f} | breakeven {be:.2f}")
    for n, L in legs.items():
        mid = (L["bid"] + L["ask"]) / 2
        if mid and (L["ask"] - L["bid"]) / mid > 0.02:
            print(f"WARN {n} leg bid/ask is {(L['ask'] - L['bid']) / mid * 100:.1f}% of premium (>2%): wide, use limit orders")
    if not 0.30 <= debit / width <= 0.45:
        print("NOTE debit is outside the 30-45% of width guideline")
    print("Lot size comes from the Fyers symbol master. Check earnings/news dates before trading.")


def synthetic(n_stocks=40, n=1500, seed=7):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2020-01-01", periods=n)
    out = {}
    names = list(UNIVERSE)[:n_stocks] + ["^NSEI"]
    for s in names:
        drift = rng.normal(0.0004, 0.0004)
        vol = rng.uniform(0.012, 0.025)
        regime = np.cumsum(rng.normal(0, 0.15, n))
        r = drift + 0.0005 * np.sin(regime) + rng.normal(0, vol, n)
        c = 100 * np.exp(np.cumsum(r))
        o = c * (1 + rng.normal(0, 0.004, n))
        h = np.maximum(o, c) * (1 + abs(rng.normal(0, 0.006, n)))
        l = np.minimum(o, c) * (1 - abs(rng.normal(0, 0.006, n)))
        v = rng.uniform(5e5, 2e6, n)
        out[s] = pd.DataFrame({"Open": o, "High": h, "Low": l, "Close": c, "Volume": v}, index=idx)
    return out


# ---------------------------------------------------------------- indicators
def add_indicators(df, bench):
    d = df.copy()
    c = d["Close"]
    for n in (20, 50, 200):
        d[f"sma{n}"] = c.rolling(n).mean()
    delta = c.diff()
    ru = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    rd = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    d["rsi"] = 100 - 100 / (1 + ru / rd)
    d["rs63"] = c.pct_change(63) - bench["Close"].pct_change(63).reindex(d.index)
    d["vol_ratio"] = d["Volume"] / d["Volume"].rolling(20).mean()
    lr = np.log(c / c.shift(1))
    d["hv20"] = lr.rolling(20).std() * math.sqrt(252)
    d["hv_pct"] = d["hv20"].rolling(252).apply(lambda x: (x <= x[-1]).mean(), raw=True)
    d["prev_high"] = d["High"].shift(1)
    d["prev_low"] = d["Low"].shift(1)
    return d


# ---------------------------------------------------------------- signals
def parts_bull(d):
    trend = (d.Close > d.sma200) & (d.sma50 > d.sma200)
    rs = d.rs63 > 0
    lo, hi = P["rsi_bull"]
    pull = d.rsi.between(lo, hi) & (d.Close <= d.sma20 * P["near_ma_up"]) & (d.Close >= d.sma50 * P["near_ma_lo"])
    trig = d.Close > d.prev_high
    volok = d.hv_pct <= P["hv_pct_max"]
    return trend, rs, pull, trig, volok


def parts_bear(d):
    trend = (d.Close < d.sma200) & (d.sma50 < d.sma200)
    rs = d.rs63 < 0
    lo, hi = P["rsi_bear"]
    pull = d.rsi.between(lo, hi) & (d.Close >= d.sma20 * (2 - P["near_ma_up"])) & (d.Close <= d.sma50 * (2 - P["near_ma_lo"]))
    trig = d.Close < d.prev_low
    volok = d.hv_pct <= P["hv_pct_max"]
    return trend, rs, pull, trig, volok


def sig_bull(d):
    t, r, p, g, v = parts_bull(d)
    return t & r & p & g & v


def sig_bear(d):
    t, r, p, g, v = parts_bear(d)
    return t & r & p & g & v


VARIANTS = {
    "bull_full": (+1, sig_bull),
    "bull_no_trigger": (+1, lambda d: (lambda t, r, p, g, v: t & r & p & v)(*parts_bull(d))),
    "oversold_only (RSI<30)": (+1, lambda d: d.rsi < 30),
    "oversold_in_uptrend": (+1, lambda d: (d.rsi < 35) & (d.Close > d.sma200)),
    "uptrend_baseline": (+1, lambda d: (d.Close > d.sma200) & (d.sma50 > d.sma200)),
    "bear_full": (-1, sig_bear),
}


# ---------------------------------------------------------------- option pricing / simulation
def ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs(S, K, T, sig, call=True, r=0.065):
    if T <= 0:
        return max(S - K, 0.0) if call else max(K - S, 0.0)
    d1 = (math.log(S / K) + (r + 0.5 * sig * sig) * T) / (sig * math.sqrt(T))
    d2 = d1 - sig * math.sqrt(T)
    if call:
        return S * ncdf(d1) - K * math.exp(-r * T) * ncdf(d2)
    return K * math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1)


def simulate(d, i, side):
    hold, left = P["hold_days"], P["time_exit_left"]
    e = i + 1
    if e + hold >= len(d):
        return None
    S0 = float(d.Open.iloc[e])
    iv = float(np.clip(d.hv20.iloc[i] * 1.1, 0.15, 0.9))
    T0 = hold / 252
    em = iv * math.sqrt(T0)
    K1, K2 = S0, S0 * (1 + side * em)
    call = side > 0
    debit = bs(S0, K1, T0, iv, call) - bs(S0, K2, T0, iv, call)
    width = abs(K2 - K1)
    if debit <= 0.05 * width or debit >= 0.8 * width:
        return None
    cost = debit * (1 + P["slippage"])
    for k in range(0, hold - left + 1):
        S = float(d.Close.iloc[e + k])
        T = max((hold - k - 0.5) / 252, 1e-6)
        val = bs(S, K1, T, iv, call) - bs(S, K2, T, iv, call)
        net = val * (1 - P["slippage"])
        why = None
        if net >= cost + P["take_profit"] * (width - cost):
            why = "TP"
        elif net <= (1 - P["stop_loss"]) * cost:
            why = "SL"
        elif k == hold - left:
            why = "TIME"
        if why:
            return dict(entry=d.index[e], days=k + 1, why=why, R=(net - cost) / cost,
                        risk_pct_spot=cost / S0 * 100)
    return None


def backtest(data):
    bench = data["^NSEI"]
    ind = {s: add_indicators(df, bench) for s, df in data.items() if s != "^NSEI"}
    rows = []
    for name, (side, fn) in VARIANTS.items():
        trades = []
        for s, d in ind.items():
            mask = fn(d).fillna(False).values
            busy = -1
            for i in np.where(mask)[0]:
                if i <= busy or i < 260:
                    continue
                r = simulate(d, i, side)
                if r:
                    r.update(sym=s, variant=name)
                    trades.append(r)
                    busy = i + 1 + r["days"]
        rows.append((name, pd.DataFrame(trades)))
    return rows


def stats(t):
    if t.empty:
        return dict(n=0)
    w, l = t[t.R > 0].R, t[t.R <= 0].R
    pf = w.sum() / -l.sum() if len(l) and l.sum() < 0 else float("nan")
    return dict(n=len(t), win_rate=round(float((t.R > 0).mean() * 100), 1),
                avg_win_R=round(float(w.mean()), 2) if len(w) else 0,
                avg_loss_R=round(float(l.mean()), 2) if len(l) else 0,
                expectancy_R=round(float(t.R.mean()), 3), profit_factor=round(float(pf), 2))


def run_backtest(data):
    res = backtest(data)
    allt = []
    print("\nBACKTEST (R = return on debit risked; expectancy_R > 0 means positive edge)\n")
    for name, t in res:
        s = stats(t)
        print(f"{name:28s}", s)
        if not t.empty:
            mid = t.entry.sort_values().iloc[len(t) // 2]
            a, b = stats(t[t.entry < mid]), stats(t[t.entry >= mid])
            print(f"{'':28s} 1st half exp_R={a.get('expectancy_R')} (n={a.get('n')}) | "
                  f"2nd half exp_R={b.get('expectancy_R')} (n={b.get('n')})")
            allt.append(t)
    if allt:
        pd.concat(allt).to_csv("backtest_trades.csv", index=False)
        print("\nTrades saved to backtest_trades.csv")
    print("\nRead it like this: the full rule set should beat the oversold-only and baseline rows, "
          "be positive in BOTH halves, and have 100+ trades before you trust it.")


# ---------------------------------------------------------------- live scan
def nice_step(p):
    return 5 if p < 200 else 10 if p < 1000 else 20 if p < 2000 else 50 if p < 5000 else 100


def run_scan(data, top=10, source="yahoo"):
    bench = data["^NSEI"]
    rows = []
    for s, df in data.items():
        if s == "^NSEI" or len(df) < 260:
            continue
        d = add_indicators(df, bench)
        last = d.iloc[-1]
        for side, fn, parts in ((+1, sig_bull, parts_bull), (-1, sig_bear, parts_bear)):
            t, r, p, g, v = [x.iloc[-1] for x in parts(d)]
            if not (t and r):
                continue
            status = "SIGNAL" if (p and g and v) else ("WATCH: needs trigger" if p and v else None)
            if not status:
                continue
            em = float(np.clip(last.hv20 * 1.1, 0.15, 0.9)) * math.sqrt(25 / 252)
            st = nice_step(last.Close)
            rows.append(dict(symbol=s, sector=UNIVERSE.get(s, ""), side="BULL CALL" if side > 0 else "BEAR PUT",
                             status=status, close=round(last.Close, 1), rsi=round(last.rsi, 1),
                             rs63_pct=round(last.rs63 * 100, 1), vol_x=round(last.vol_ratio, 2),
                             hv_pctile=round(last.hv_pct, 2),
                             long_strike_approx=round(last.Close / st) * st,
                             short_strike_approx=round(last.Close * (1 + side * em) / st) * st))
            if source == "fyers":
                ex = monthly_expiry()
                cp = "CE" if side > 0 else "PE"
                rows[-1]["expiry"] = ex.isoformat()
                rows[-1]["fyers_long_hint"] = fy_opt(s, ex.year % 100, MONTHS[ex.month - 1], rows[-1]["long_strike_approx"], cp)
                rows[-1]["fyers_short_hint"] = fy_opt(s, ex.year % 100, MONTHS[ex.month - 1], rows[-1]["short_strike_approx"], cp)
    if not rows:
        print("No candidates today. That is a valid result: no trade is a position.")
        return
    df = pd.DataFrame(rows)
    df["abs_rs"] = df.rs63_pct.abs()
    df = df.sort_values(["status", "abs_rs"], ascending=[False, False])
    picked, count = [], {}
    for _, r in df.iterrows():
        k = (r.sector, r.side)
        if count.get(k, 0) >= 2:
            continue
        count[k] = count.get(k, 0) + 1
        picked.append(r)
    out = pd.DataFrame(picked).drop(columns="abs_rs").head(top)
    print(out.to_string(index=False))
    out.to_csv("shortlist.csv", index=False)
    print("\nSaved shortlist.csv. Before trading each name: check earnings/news dates, option bid-ask "
          "within ~2% of premium, OI, and that debit is 30-45% of spread width.")


# ---------------------------------------------------------------- main
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["scan", "backtest", "check"])
    ap.add_argument("--source", choices=["yahoo", "fyers"], default="yahoo")
    ap.add_argument("--symbol")
    ap.add_argument("--side", choices=["bull", "bear"], default="bull")
    ap.add_argument("--long", type=float, dest="k_long")
    ap.add_argument("--short", type=float, dest="k_short")
    ap.add_argument("--expiry", help="e.g. 26OCT (YY + MON), monthly stock expiry")
    ap.add_argument("--synthetic", action="store_true", help="fake data to test the code")
    ap.add_argument("--years", type=int, default=5)
    ap.add_argument("--top", type=int, default=10)
    a = ap.parse_args()
    if a.mode == "check":
        if not (a.symbol and a.k_long and a.k_short and a.expiry):
            sys.exit("check needs --symbol --long --short --expiry")
        live_check(a.symbol.upper(), 1 if a.side == "bull" else -1, a.k_long, a.k_short, a.expiry)
        sys.exit(0)
    data = synthetic() if a.synthetic else (load_fyers(a.years) if a.source == "fyers" else load_yahoo(a.years))
    if "^NSEI" not in data:
        sys.exit("Benchmark ^NSEI failed to download")
    run_backtest(data) if a.mode == "backtest" else run_scan(data, a.top, a.source)
