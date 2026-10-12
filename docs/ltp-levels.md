# LTP Levels

A rule-based reading of option-chain volume and open interest (OI), built from the published description of Dr. Vinay Prakash Tiwari's LTP Calculator. It is **not** a copy of that tool and has **not been validated**. Nothing here places, modifies or cancels an order; the app is paper-only and the FYERS endpoints used are read-only.

Section letters (A to G) and C1 to C10 refer to the original task brief.

## What it does

Every minute from 09:15:00 to 15:30:00 IST on trading days, a recorder stores the nearest-expiry option chain for NIFTY 50, BANK NIFTY and SENSEX. The **LTP Levels** tab reads only the stored snapshots (never FYERS) and shows what the rules say for a chosen underlying and day. Outside market hours it shows the last stored day, as recorded.

## Rules

| Brief | Rule | Code |
|---|---|---|
| A | FYERS `options-chain-v3` response is parsed into snapshots. Spot is the leg with `option_type ""` and `strike_price -1`. The strike step is the most common difference between strikes (expected NIFTY 50, BANKNIFTY 100, SENSEX 100; a mismatch logs a warning). `strikecount` 20 gives 41 strikes. A missing field is stored as NULL and flagged, never as zero. | `lib/ltp/chain.ts`, `lib/screener/broker/fyers.ts` |
| B | Recorder: one snapshot per underlying per minute, stamped with the minute it belongs to. Primary key `(underlying, expiry, snapshot_ts, strike, side)`, so repeating a minute adds nothing. A failed minute becomes a row in `recorder_gaps` with a reason (`login_required`, `upstream`, parse reasons). Gaps are never backfilled or interpolated. A snapshot at exactly 15:30:00 is recorded (376 per day). | `lib/ltp/recorder.ts`, `lib/ltp/store.ts` |
| C1 | Imaginary line: the two adjacent strikes that bracket the spot. A spot exactly on a strike is that strike and belongs to both searches. No line if the spot is outside the strikes or fewer than two strikes exist. | `levels.ts` |
| C2 | Support: the put strike with the highest volume and the one with the highest OI, searched over **every strike**, in-the-money ones included. Resistance: the same for calls. Checked against the real tool on 2026-10-12: its SENSEX support stayed at 72000 from 11:23 to the close while the spot sat below 71900, so the line does not limit the search. If volume and OI disagree, the strike nearer the line decides (distance counts both ways). Strikes with no value are skipped. | `levels.ts` |
| C3 | Strength: second-highest divided by highest, as a percent, per side and per metric. Above 75 is weak; exactly 75 is still Strong. A second-highest above the level is WTT, below is WTB. For a level based on both metrics, one weak metric whose second-highest sits away from the line stays Strong; toward the line makes it Weak. For a level based on one metric only, that metric's own box decides, and the other metric counts only if its box crosses the level on the line side. Both weak in the same direction takes that direction; opposite directions go to the metric nearer the line. A level shift is logged with its cause. A weakness at the strike the level just left counts at once: the real tool prints it right after the shift (SENSEX resistance, 11:17: shifted to 72500, shown as WTT-73000). | `strength.ts` |
| C4 | Reversal values and the EOS/EOR family (EOS, EOS+1, EOS-1, -2, EOR, EOR-1, EOR+1, +2, WTB+1, WTT-1). **All proxies**, see below. The default method is `iv_move`, fitted to the real tool. | `extensions.ts` |
| C5 | COA 1.0: nine scenarios from (support status, resistance status), kept as a data table. Hit counter: each approach within 5 points of a reversal level counts once; one hit reads "generally safe", two or more "risk rising". | `coa1.ts` |
| C6 | COA 2.0: OI trend (increasing / decreasing / stable) of CE OI at the resistance strike and PE OI at the support strike over the last 30 minutes, nine scenarios, valid 09:45 to 14:30 IST inclusive, and not read on the first touch of an extension level. | `coa2.ts` |
| C7 | Diversions: the strikes strictly between support and resistance, plus one. Each has a diversion price and an end-of-diversion price in each direction. The same strike on both sides gives 0. | `diversions.ts` |
| C8 | State of Confusion (SOC): one side weak while the other is Strong. 1 hour: weak more than 60 minutes with a pct spread of at most 5 and no shift. 2 hours: at least 120 minutes with a spread of at most 15 and no shift. 3 hours: the level has shifted and been weak again for more than 180 minutes. | `soc.ts` |
| C9 | The 9:20 lines: the first snapshot at or after 09:20:00 freezes the lines for the day (saved once, never recomputed), laid out like the real tool's header. Short side: Risky = EOR-1, Moderate = EOR, Max Pain = EOR+2, Max Gain = EOS. Long side: Risky = EOS+1, Moderate = EOS, Max Pain = EOS-2, Max Gain = EOR. Max Pain is also the stop. Displayed only. If the first snapshot is more than 2 minutes late the tab says so. | `lines0920.ts` |
| C10 | Weekly range: the first stored day's CMP plus or minus 1, 2 and 3 times (first out-of-the-money call LTP + put LTP). Flagged `late_start` if not computed from the 09:15 snapshot. | `weekly.ts` |
| C11 | Side direction and banner (inferred from the real tool's logs): weak towards top is bullish, weak towards bottom bearish, "WTT TO STRONG" bearish, "WTB TO STRONG" bullish, a level shifting up bullish and down bearish. A side's direction is that of its latest event. Both sides bearish is **Blood Bath**, both bullish is **Bull Run**, anything else is shown as mixed. This is separate from the nine-scenario COA 1.0 table, which is still shown. | `direction.ts` |
| D | Calibration log: you type in what the LTP Calculator website showed for EOS, EOR, EOS-1 or EOR+1 at a time; the log stores each proxy's value for the same moment and reports mean absolute error, median error and error in strike steps per method. | `calibration.ts` |
| E | The tab: header with health badge, levels, scenario cards, 9:20 lines, weekly range, chain table around the line, three charts, level-shift log, calibration, disclaimer. | `app/ltp-tab.tsx` and friends |

All thresholds live in `lib/ltp/config.ts`, each marked as taken from the brief or assumed. The engine is pure: no clock, no network, and `now` is passed in, so a stored day can be replayed exactly as it looked live.

## What is a proxy or an assumption

Read the screen with these in mind. None of it has been checked against the real LTP Calculator.

- **EOS and EOR (and every value derived from them).** The calculation is not published. The default proxy, `iv_move`, was fitted to 14 strikes captured from the real tool on 2026-10-12 around 10:30 (NIFTY): the extension is about 0.107 (calls) or 0.088 (puts) of spot x implied volatility x sqrt(time to expiry), with each strike's own implied volatility backed out of its LTP (Black-Scholes, zero interest, time to 15:30 IST on the expiry date). It is within about 1 point there, but far out of the money the real values shrink in a way this does not copy, and it was fitted to one day. Two older proxies remain selectable: writer breakeven (strike minus or plus the LTP, about 60 points off at the money) and time value only. All are labelled "(proxy: ...)", and the calibration log measures how far off they are. The frozen 9:20 lines use the default method.
- **Direction and banner.** Inferred from event logs the real tool shows, checked on NIFTY, BANKNIFTY, SENSEX and one December screenshot. The tool's logs start at 09:15, so a recorder that starts later cannot reproduce a side's direction exactly; the "mixed" case is not named by the tool as far as I know.
- **Support and resistance search range.** Taken from the real tool's behaviour (all strikes, in-the-money included), not from the written theory, which says to search outward from the pair.
- **WTB+1 and WTT-1** are taken from the weak metric's second-highest strike, one step further out.
- **COA 2.0 numbers.** The method gives none; the 5 percent "stable" band and 30-minute lookback are my own.
- **SOC "range".** Read as the spread (max minus min) of the side's pct over the whole weak run.
- **C3 combining.** "Toward the line" means the second-highest strike lies between the level and the line. The brief's examples beyond the shift sequence were not available, so this is my reading.
- **Hit tolerance** of 5 points for a touch is assumed.
- **SENSEX.** `BSE:SENSEX-INDEX` works with the chain endpoint, but its options are thin, so many strikes have no volume.
- **Expiry.** Nearest expiry only; today's expiry is used until 15:30 IST inclusive.
- **Holidays** come from the app's existing NSE holiday list, which is marked unverified.
- **Fixtures.** The test fixtures contain the real legs and expiry list; the surrounding envelope was inferred.

## Running it

The recorder needs a FYERS login. There are three ways:

1. **In the tab.** Open LTP Levels while logged in with Connect FYERS. **Record now** stores one snapshot; the checkbox records every minute while the tab stays open. Reloading or closing the tab stops it.
2. **Background runner.** Put `FYERS_ACCESS_TOKEN` in `.env.local` (the app reads it; do not paste it anywhere else) and keep the app running (`npm run dev`). The token **expires daily**, so renew it each morning; an expired token appears as `login_required` gap rows and the runner prints a message.
   ```bash
   npm run ltp:record-once   # one snapshot of all three underlyings now (add --force outside market hours, for testing)
   npm run ltp:record        # every minute, 09:15 to 15:30 IST on trading days, until you stop it
   ```
3. **Replay a stored day.** Reads the app's local database read-only, needs neither the app nor FYERS, and writes a CSV with one row per minute (each row sees only snapshots up to its own time):
   ```bash
   npm run ltp:replay -- --date 2026-10-12 --underlying NSE:NIFTY50-INDEX
   ```
   The file goes to `data/ltp_replay/<date>-<underlying>.csv`. Pass `--db <file>` to use another database.

Start before 09:15, or the 9:20 lines and the weekly range will be flagged late.

## Before any backtest

Do not draw conclusions from a few days. A backtest of these rules needs at least **20 recorded sessions** with few gaps, and the EOS/EOR proxies should first be calibrated against the website's own values. The backtest itself is out of scope for this version.

## Footer shown in the tab

"Rule-based reading of OI/volume; not validated; levels using EOS/EOR are proxies."
