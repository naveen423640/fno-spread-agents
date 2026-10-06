# Screener tab gate record

- **Date:** 2026-10-06
- **Branch:** `screener-tab` (cut from `main` at `7043a37`)
- **Plan:** `docs/superpowers/plans/2026-10-06-screener-tab.md`
- **Source of truth:** `screener/fo_spread_screener.py` and `screener/trade-rules.md`

## 1. Headline

The Screener tab is built, parity-tested against your Python reference, and shown working on **synthetic data**. **No live FYERS call has been made.** At the time of writing the FYERS tools in this session had no token ("failed to get token") and the app's browser pane was not connected, so every live-data path is unverified. Kite has never been contacted. Read section 5 before trusting anything the tab shows on live data.

## 2. Verification run

| Check | Result |
|---|---|
| `npx vitest run` | 1140 passed, 1 skipped (the oracle dump helper, skipped by design) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | "Build complete" |
| `npm run lint` | 29 errors, the same baseline as before, none in the new files |
| `tests/safety/*` | pass (one deliberate allowlist addition, see section 4) |
| Parity with the Python reference | indicators, signal masks, `simulate`, every variant's trades, stats and half-period stats, scan rows at 540 as-of dates, expiry, option symbols, Black-Scholes, strike steps: all equal |
| Browser (dev server) | Screener tab renders; synthetic scan shows a 67-stock table with 3 SIGNAL and 5 WATCH rows (SIGNAL first); candidate drawer shows the chart, live check (synthetic quotes) and action plan; Backtest shows six variants with the banner, half-period columns and the under-100 flag; Settings shows the reference parameters |
| API with curl | `text/plain` POST is 403, bad kind is 400, live source without login is 401, synthetic scan and backtest jobs finish |

How parity is proven: `screener/gen_golden.py` runs the reference **unchanged** on seeded synthetic data and writes `tests/fixtures/screener/golden.json` (637 KB, inputs rounded to 4 decimals before anything is computed). The TypeScript tests reproduce every number. Regenerate with `python screener/gen_golden.py`.

## 3. Rules

The rule logic is unchanged: `DEFAULT_PARAMS` equals dict `P` (a test compares them), the universe equals `UNIVERSE`, and the six variants and their sides equal the reference.

## 4. Deviations from the reference and the brief (each with its reason)

1. **TypeScript port instead of Python endpoints.** The app server is TypeScript, the Python engine has no pandas and is not running by default, and the app's FYERS login is cookie-based. The port reuses the app's existing login and adds no dependency.
2. **Yahoo source dropped.** It is an unofficial API and not in your adapter list. Sources are `fyers`, `kite` and `synthetic`.
3. **Reference bug fixed: SIGNAL before WATCH.** The reference sorts the status strings descending, which puts "WATCH: needs trigger" before "SIGNAL". On the fixture, 6 of 6 scans containing both statuses show the reference putting WATCH first. The port sorts SIGNAL first, then by absolute relative strength, and the sector cap runs in that order. This changes which rows survive the cap.
4. **Completed sessions only.** The reference uses the unfinished candle of the current day during market hours. The port drops any candle for a session that has not ended (15:30 IST), using the app's `lastCompletedSession`.
5. **Live check uses `quotes` and `options-chain-v3`, not `depth`.** `depth` is not on the app's endpoint allowlist. Bid and ask come from `quotes`, OI from the option chain (nearest expiry only; otherwise "n/a").
6. **Rules doc and code disagree:** `trade-rules.md` says IV percentile "below ~50%", the code has `hv_pct_max=0.60`. The code value is kept.
7. **Display aids derived from `trade-rules.md`, not entry rules:** support and resistance (swing pivots of the last 120 sessions), price-stop levels (20-DMA and recent swing), and the gap-open wording. The gap-open rules are my wording; the rules file has no explicit gap section.
8. **The scan returns all rows after the sector cap** (the reference script's CLI also cut to the top 10). The table shows all of them with filters.
9. **"Disk" cache is D1** (a sqlite file in local dev). One JSON row per source and symbol, because D1 limits bound parameters per statement. It remembers how far back the last request reached, so a short-history stock is not refetched on every load.
10. **Synthetic data uses a different random generator** (seeded mulberry32 with Box-Muller), same recipe as the reference. Numbers differ from numpy's.
11. **Safety-test allowlist gained one path:** `/sym_details/NSE_FO`, FYERS's public symbol master CSV, needed for lot sizes (the reference reads it too). It is read-only.
12. **Ties in the scan sort are stable;** the reference's pandas sort is not guaranteed stable.
13. **Own `erf` and Python-style `round`** (half to even, ties found from the exact decimal expansion) so results match Python. Both are tested.
14. **Kite adapter written from the public API docs, mock-tested only.** No Kite config or login existed in this app, so there is nothing to "reuse"; it reads `KITE_API_KEY` and `KITE_ACCESS_TOKEN` from env.

## 5. NOT verified (stated plainly)

1. **Every live FYERS call.** History, quotes (are `bid`, `ask` and `oi` present for option symbols?), options-chain-v3 (expiry date format `DD-MM-YYYY`, field names), and the symbol master (lot size in column 3 and ticker in column 9, taken from your script) were written from the documentation and the reference and tested with mocked responses only.
2. **FYERS auth error codes.** The adapter treats HTTP 401 and codes -8, -15, -16, -17 as "login required". These come from FYERS documentation as I recall it and are not confirmed against a real expired token. (The Markov tab still uses `-22`, which has no source; that earlier item is unchanged.)
3. **Kite, entirely.** Never contacted. Historical data may also need Kite's paid add-on.
4. **Live scan duration.** About 68 symbols x 3 history chunks (2 years) at 400 ms each is roughly 80 seconds for a scan; a 5-year backtest load is roughly twice that. The first live run is slow; later runs only fetch a short overlap.
5. **Cloudflare deployment.** Jobs run as background work (`waitUntil` if available, otherwise a detached promise). That worked locally. Worker time limits for a 1.5 to 3 minute job, and how D1 migrations are applied on deploy, are unchecked.
6. **Expiry and holidays.** The monthly expiry is computed as the last Tuesday and is not shifted for holidays. The holiday list (`reference/nse_holidays.json`) is marked unverified; it is used for the last completed session and the time-stop date. Always confirm the expiry with your broker.
7. **Backtest realism.** Options are modelled with Black-Scholes and an IV proxy; there are no real option prices. Synthetic backtest numbers say nothing about any market.
8. **No authentication on the new routes.** `POST /api/screener/jobs` requires a JSON body, rejects cross-site browser fetches and is capped per 24 hours (default 20, `SCREENER_JOBS_PER_DAY`); GET routes are open. Put the app behind its deployment access control before any cloud deploy. A job started without a cookie falls back to the server's `FYERS_ACCESS_TOKEN`, as the other routes do.
9. **Real FYERS data was never compared with the Yahoo/Fyers output of the Python script.** The only comparison is on seeded synthetic data.

## 6. How to run the live verification (needs you)

1. Connect FYERS in the app (the "Connect FYERS" button; the cookie lasts the day).
2. Open Screener, choose the FYERS (live) source, run a scan, then open a SIGNAL or WATCH row and press "Check live quotes". Compare the bid, ask, OI, lot size and expiry with the FYERS app by eye.
3. If anything looks wrong, tell me what you see; the call log of the failing request is the first thing to check.

## 7. Recommendation

Use the tab on synthetic data to learn the screens, and do the live verification in section 6 before relying on any live number. Do not treat any backtest, synthetic or modelled, as evidence of edge; the rules file itself says a positive result is a reason to paper-trade, not to size up.
