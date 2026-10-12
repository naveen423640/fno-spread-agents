# LTP Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "LTP Levels" tab that reads FYERS option-chain snapshots and shows support/resistance, Strong/WTT/WTB status, COA 1.0/2.0, diversions, State of Confusion, the 9:20 lines and the weekly range, backed by a background recorder that stores a snapshot every minute.

**Architecture:** A pure engine (`lib/ltp/`) takes time-ordered snapshots plus a config and returns plain objects; it never reads a clock or the network. A normaliser turns the FYERS chain response into snapshots, a recorder writes them idempotently to D1/SQLite, and the tab reads only the store. Replay runs the same engine over a stored day.

**Tech Stack:** TypeScript (the app's language), vitest, D1/SQLite via the existing drizzle migrations, the existing FYERS broker wrapper (`lib/screener/broker/fyers.ts`), `lightweight-charts` for charts.

**Spec:** the task brief "LTP Levels" pasted in the conversation of 2026-10-12 (sections A to G). No separate spec file exists; section letters below refer to it.

## Decisions that need your approval before any code

1. **TypeScript, not Python.** The app is vinext/React/TypeScript; the brief's Python SDK, dataclasses, YAML, Parquet and DuckDB map to TS types, `lib/ltp/config.ts`, and D1/SQLite. No new dependencies. A Parquet export is not built; `replay` writes CSV.
2. **Chain field names are unverified.** The only FYERS chain code in the repo reads `option_type`, `strike_price`, `oi`, `oich`, `prev_oi`, `ltp`; nothing reads a volume field or a per-leg `symbol`. Task 0 captures one real response (needs your login) and every adapter test uses that fixture.
3. **Recorder = a Node script that calls the app's route each minute** (same pattern as `scripts/board-poller.mjs`), because the app has no scheduler and no Worker cron config. It needs the dev server running and `FYERS_ACCESS_TOKEN` in `.env.local`; an expired token becomes gap rows with reason `login_required`.
4. **SENSEX is unproven.** `BSE:SENSEX-INDEX` appears nowhere in the app and the symbol master we use is NSE only. Support is built generically (step and expiry come from the response); whether FYERS serves the chain for it is checked in Task 0 and reported, not assumed.
5. **Branch:** new branch `ltp-levels` cut from `vwap-scan` (tab registration in `app/page.tsx` is shared with the earlier tabs).
6. **Interpretations I will make where the brief is ambiguous** (each is documented in `docs/ltp-levels.md` and covered by a test): C3's combining rule is applied per side as written, with "toward the line" meaning the second-highest strike lies between the level and the line; the SOC "range" is `max(pct) - min(pct)` over the window; a snapshot at exactly 15:30:00 is recorded (376 per day per underlying); the existing NSE holiday list (`reference/nse_holidays.json`, marked unverified) is used and the health panel says so.

## Global Constraints

- Never place, modify or cancel orders; read-only FYERS endpoints only (the safety test `tests/safety/no-order-endpoints.test.ts` must stay green; `options-chain-v3` and `history` are already allowed).
- No keys in code, logs or commits; credentials via `fyersCredentials()` (cookie or `FYERS_ACCESS_TOKEN`).
- Underlyings: `NSE:NIFTY50-INDEX`, `NSE:NIFTYBANK-INDEX`, `BSE:SENSEX-INDEX`. Nearest expiry only (today's expiry until 15:30).
- Strike step derived from the strikes returned (most common difference); expected NIFTY 50, BANKNIFTY 100, SENSEX 100; log a warning on a mismatch. `strikecount` configurable, default 20.
- Engine functions are pure: no I/O, no clock; `now` is passed in. All thresholds in `lib/ltp/config.ts` with the defaults: `weak_threshold_pct` 75, `coa2_stable_band_pct` 5, `coa2_lookback_min` 30, COA 2.0 window 09:45 to 14:30 IST, stop buffer 10 points, SOC ranges 2 to 5 / 10 to 15 points, SOC durations 60 / 120 / 180 min.
- Recorder: every 60 s from 09:15:00 to 15:30:00 IST on trading days; primary key `(underlying, expiry, snapshot_ts, strike, side)`; gaps logged with a reason, never backfilled or interpolated; missing fields stored NULL and flagged.
- Every EOS/EOR-derived value carries `method` and `is_proxy: true` and is labelled "(proxy: writer breakeven)" in the UI. Disclaimer footer text: "Rule-based reading of OI/volume; not validated; levels using EOS/EOR are proxies."
- The UI reads only from the store and never calls FYERS. Auto-refresh every 60 s.
- Stop after each milestone (engine, adapter + recorder, UI, docs) and wait for your go-ahead.

## Review Focus

1. **A chain with no OI or volume on one side (illiquid far strikes, a half-empty response).** Expected: levels use only strikes with data, missing values are NULL and flagged, nothing is invented. Test in Task 2 and Task 12.
2. **Spot outside the returned strikes, or a one-strike chain.** Expected: a clear "no usable levels" result, not a crash or a wrong line. Test in Task 2.
3. **The same strike winning on both sides of the line** (support equals resistance, exact-strike spot). Expected: diversions 0, no division by zero in `pct`, level marked correctly. Tests in Tasks 2, 3 and 7.
4. **A recorder minute that fails, repeats, or lands on a holiday or after 15:30.** Expected: a gap row with a reason, no duplicate rows, no snapshot outside 09:15 to 15:30, and no fabricated data. Test in Task 14.
5. **The UI opened outside market hours, before the first snapshot, or with a stale recorder.** Expected: renders the last stored day, shows "no data yet" before the first snapshot, and the health badge is red. Test in Task 16.

## File Structure

| File | Responsibility |
|---|---|
| `lib/ltp/config.ts` | every threshold, with a one-line comment each |
| `lib/ltp/types.ts` | `Snapshot`, `ChainRow`, level, status, event, result types shared by all engine files |
| `lib/ltp/levels.ts` | C1 imaginary line, C2 support/resistance per metric and the final level |
| `lib/ltp/strength.ts` | C3 pct, Strong/WTT/WTB, combining, shifts, old-strike rule, pct history |
| `lib/ltp/extensions.ts` | C4 `ExtensionMethod`, `writer_breakeven`, `time_value_only`, EOS/EOR and variants |
| `lib/ltp/coa1.ts` | C5 data table, selector, trade mapping, hit counter |
| `lib/ltp/coa2.ts` | C6 trend classification, table, window |
| `lib/ltp/diversions.ts` | C7 count and price list |
| `lib/ltp/soc.ts` | C8 State of Confusion |
| `lib/ltp/lines0920.ts` | C9 frozen lines, entries, stops, targets |
| `lib/ltp/weekly.ts` | C10 weekly range |
| `lib/ltp/analyze.ts` | `analyzeSession`: runs all of the above over a snapshot list |
| `lib/ltp/chain.ts` | A: parse the FYERS response into a `Snapshot`, expiry choice, step derivation |
| `lib/ltp/store.ts` + `drizzle/0008_ltp.sql` + `db/schema.ts` | snapshots, gaps, frozen lines, weekly ranges, calibration |
| `lib/ltp/recorder.ts` | B: `recordOnce`, schedule window, health, gaps |
| `lib/ltp/calibration.ts` | D: error summaries per method |
| `app/api/ltp/{record,state,calibration}/route.ts` | server entry points |
| `scripts/ltp-recorder.ts` | `record-once`, `run` (loop), `replay` commands |
| `app/ltp-tab.tsx` (+ small child components) | E: the tab |
| `tests/support/ltp-chain.ts` | `makeChain` synthetic snapshot builder |
| `docs/ltp-levels.md` | G |

---

## Milestone 1: Engine (pure)

### Task 0: Capture a real chain response and set up the branch

**Files:**
- Modify: `lib/vwap/option-probe.ts` (add `rawSample`), `tests/vwap/option-probe.test.ts`
- Create: `tests/fixtures/ltp/nifty-chain.json` (saved from the real response)

**Interfaces:**
- Produces: `OptionProbe.chain.rawSample: Record<string, unknown>[]` (first 6 legs of the real response, unmodified) and a saved fixture used by Tasks 12 and 16.

- [ ] **Step 1:** `git checkout -b ltp-levels` from `vwap-scan`.
- [ ] **Step 2:** Add a test to `tests/vwap/option-probe.test.ts` that `probeOptionData` returns `chain.rawSample` with the first 6 legs untouched.
- [ ] **Step 3:** Add `rawSample` to `probeOptionData`; run `npx vitest run tests/vwap/option-probe.test.ts` (expect PASS).
- [ ] **Step 4 (needs you):** you open `/api/vwap/option-probe` (and I add `?symbol=` for BANKNIFTY and SENSEX) while logged in; I save the NIFTY response as `tests/fixtures/ltp/nifty-chain.json` and report the real field names, volume field, `symbol` field, expiry format, and whether BANKNIFTY and SENSEX answer.
- [ ] **Step 5:** commit `feat: capture a real option-chain sample`.

### Task 1: Config, types and the synthetic chain builder

**Files:** Create `lib/ltp/config.ts`, `lib/ltp/types.ts`, `tests/support/ltp-chain.ts`; Test `tests/ltp/config.test.ts`.

**Interfaces:**
- Produces: `LTP_CONFIG` (all values listed under Global Constraints, each with a comment), `type Side = 'CE'|'PE'`, `type Metric = 'volume'|'oi'`, `type Status = 'strong'|'wtt'|'wtb'`, `ChainRow`, `Snapshot { ts: number; underlying: string; expiry: string; spot: number; step: number; rows: ChainRow[] }`, `valueAt(s: Snapshot, strike: number, side: Side, metric: Metric | 'ltp' | 'oiChange'): number | null`, and `makeChain(opts: { spot; step; strikes?; ts?; ce?: Partial<Record<number, {ltp?; oi?; volume?}>>; pe?: ...; underlying?; expiry? }): Snapshot` with deterministic defaults (every strike 1000 volume/OI, LTP 100) so a test overrides only what it checks.

- [ ] **Step 1:** test: `LTP_CONFIG.weakThresholdPct === 75`, `coa2.windowStart === '09:45'`, `soc.oneHour.minutes === 60`; `makeChain({spot: 24037, step: 50})` has the strikes around 24000 to 24050 and `valueAt` returns the override passed for one cell and `null` for a strike not in the chain.
- [ ] **Step 2:** run, expect FAIL; **Step 3:** implement; **Step 4:** run, expect PASS; **Step 5:** commit.

### Task 2: Imaginary line and support/resistance (C1, C2)

**Files:** Create `lib/ltp/levels.ts`; Test `tests/ltp/levels.test.ts`.

**Interfaces:**
- Consumes: Task 1 types and `makeChain`.
- Produces: `imaginaryLine(spot: number, strikes: number[]): { low: number; high: number; exact: boolean } | null` and `computeLevels(s: Snapshot): Levels | null` where `Levels = { line: {low; high; exact}; support: SideLevel; resistance: SideLevel }`, `SideLevel = { strike: number; decidedBy: 'volume'|'oi'|'volume+oi'; byVolume: MetricPick; byOi: MetricPick }`, `MetricPick = { strike: number; value: number; secondStrike: number | null; secondValue: number | null }`.

- [ ] **Step 1: tests** (names and assertions):
  - `spot 24037, step 50 gives low 24000 / high 24050, exact false`; `spot 24050 gives low = high = 24050, exact true and that strike is eligible for both searches`.
  - `support takes the highest PE value among strikes <= line; resistance the highest CE value among strikes >= line`.
  - `equal highest volume at two strikes: the one closer to the line wins`.
  - `volume and OI pick different strikes: the one closer to the line is the final level and decidedBy names that metric; the same strike gives 'volume+oi'`.
  - Review Focus 1 and 2: `strikes with null OI are skipped, never treated as zero`; `spot below every strike, or a single-strike chain, returns null`.
- [ ] **Step 2:** run, expect FAIL; **Step 3:** implement; **Step 4:** run, expect PASS; **Step 5:** commit.

### Task 3: Strength, shifts and pct history (C3)

**Files:** Create `lib/ltp/strength.ts`; Test `tests/ltp/strength.test.ts`.

**Interfaces:**
- Consumes: `computeLevels`.
- Produces: `pctOf(pick: MetricPick): number | null`; `statusOf(side: 'support'|'resistance', level: SideLevel, cfg): { status: Status; byMetric: { volume: MetricStatus; oi: MetricStatus } }`; `trackStrength(snaps: Snapshot[], cfg): { perSnapshot: StrengthPoint[]; events: LevelShift[] }` with `LevelShift = { ts; side; metric; fromStrike; toStrike }` and `StrengthPoint` holding `pct` per side and metric (the series the UI charts).

- [ ] **Step 1: tests:**
  - 75% boundary: `pct 75.00 is Strong; 75.01 is Weak`; second-highest above the level is WTT, below is WTB.
  - Shift sequence from the brief: support 24400, 24300 second at 92.93% (WTB); over three snapshots 24300 rises to 99% and then above 24400. Assert one `LevelShift {side:'support', fromStrike:24400, toStrike:24300}`. Second series: 24300 falls to 80% then 74%: support stays 24400, Strong, zero events.
  - Combining: one metric weak with its second-highest moving away from the line stays Strong; moving toward the line is Weak (support WTT, resistance WTB); WTT versus WTB across the two metrics is decided by the metric whose level is closer to the line.
  - Old-strike rule: after a shift, a weakness signal at the old strike is ignored until its pct has dropped to <= 75 and risen above 75 again.
  - Review Focus 3: highest value 0 does not divide by zero (`pct` is `null`, status Strong).
- [ ] **Step 2 to 5:** FAIL, implement, PASS, commit.

### Task 4: Extension methods (C4)

**Files:** Create `lib/ltp/extensions.ts`; Test `tests/ltp/extensions.test.ts`.

**Interfaces:**
- Produces: `interface ExtensionMethod { id: string; label: string; reversal(s: Snapshot, strike: number, side: Side): number | null }`; `writerBreakeven`, `timeValueOnly`; `extensionLevels(s, levels, status, method): { eos; eor; eosMinus(n); eorPlus(n); wtbPlus1; wttMinus1 }` each as `{ value: number | null; strike: number; method: string; isProxy: true }`.

- [ ] **Step 1: tests:** `writer_breakeven put-side reversal at 24000 with PE LTP 85.5 is 23914.5`; call side is `strike + CE_ltp`; `EOS-n and EOR+n move by n * step`; `time_value_only` subtracts intrinsic value (a call 100 points in the money with LTP 130 contributes 30); both methods are interchangeable through the interface (same call signature, different numbers); every returned level has `isProxy: true` and its method id; a missing LTP gives `value: null`.
- [ ] **Step 2 to 5:** FAIL, implement, PASS, commit.

### Task 5: COA 1.0 (C5)

**Files:** Create `lib/ltp/coa1.ts`; Test `tests/ltp/coa1.test.ts`.

**Interfaces:**
- Produces: `COA1_TABLE: Record<`${Status}|${Status}`, Coa1Scenario>` keyed by (support status, resistance status); `selectCoa1(support: Status, resistance: Status): Coa1Scenario` where `Coa1Scenario = { number: 1..9; bias: string; top: string | null; bottom: string | null; allowed: string[]; tradable: boolean }`; `tradeMapping(at: 'top'|'bottom'): string[]`; `countHits(prices: number[], level: number, tolerance: number): number` and `hitLabel(n: number): 'generally safe' | 'risk rising' | null`.

- [ ] **Step 1: tests:** all 9 combinations assert scenario number, bias text, reversal labels (`EOR`, `EOS-1`, `WTT-1`, `WTB+1`, `EOR+1`, or `null`) and allowed trades exactly as in the brief's table (the table is encoded as data and the test reads the same keys); rows 8 and 9 are `tradable: false`; bottom reversal maps to "buy CE, buy futures, sell PE", top to "buy PE, sell futures, sell CE"; first touch labelled "generally safe", later "risk rising", zero touches `null`.
- [ ] **Step 2 to 5:** FAIL, implement, PASS, commit.

### Task 6: COA 2.0 (C6)

**Files:** Create `lib/ltp/coa2.ts`; Test `tests/ltp/coa2.test.ts`.

**Interfaces:**
- Produces: `classifyTrend(series: {ts: number; oi: number}[], now: number, cfg): 'increasing'|'decreasing'|'stable'|null`; `selectCoa2(call: Trend, put: Trend, nowIst: {hhmm: string}, opts: { firstHitOfExtension: boolean }): { status: 'ok'|'outside_window'|'not_on_first_hit'; number?: 1..9; outcome?: string }`.

- [ ] **Step 1: tests:** change of exactly 5% is stable, 5.01% is increasing/decreasing; all nine (call trend, put trend) pairs map to the outcomes in the brief's table; `09:40 and 14:35 return outside_window`, `09:45 and 14:30 are inside`; the first hit of an extension returns `not_on_first_hit`, the second is allowed; fewer than two points in the lookback returns `null`.
- [ ] **Step 2 to 5:** FAIL, implement, PASS, commit.

### Task 7: Diversions (C7) and Task 8: State of Confusion (C8)

**Files:** Create `lib/ltp/diversions.ts`, `lib/ltp/soc.ts`; Tests `tests/ltp/diversions.test.ts`, `tests/ltp/soc.test.ts`.

**Interfaces:**
- Produces: `diversionCount(support: number, resistance: number, step: number): number`; `diversionPath(s: Snapshot, support: number, resistance: number, dir: 'bullish'|'bearish', method: ExtensionMethod): { kind: 'diversion'|'end_of_diversion'; strike: number; price: number | null; isProxy: true }[]`; `detectSoc(history: StrengthPoint[], supportStatus, resistanceStatus, cfg): SocResult | null` with `SocResult = { type: '1h'|'2h'|'3h'; side: 'support'|'resistance'; startedAt: number; bias: 'bearish'|'bullish'; target: 'lowest diversion in the zone' | 'highest diversion in the zone' }`.

- [ ] **Step 1: tests:** diversions `17600/17700 step 50 = 2`, `550/560 step 10 = 1`, `41500/41500 = 0`; bearish path is the mirror of bullish; SOC 1-hour (pct range 2 to 5 points for more than 60 minutes, no shift), 2-hour (range 10 to 15 for 120 minutes), 3-hour (shifted and weak again for more than 180 minutes); negative case: the opposite side also weak returns `null`; the clock starts when the side first became WTT/WTB; range is `max - min` of pct (documented).
- [ ] **Step 2 to 5:** FAIL, implement both, PASS, commit.

### Task 9: 9:20 lines (C9) and Task 10: weekly range (C10)

**Files:** Create `lib/ltp/lines0920.ts`, `lib/ltp/weekly.ts`; Tests alongside.

**Interfaces:**
- Produces: `freezeLines0920(snaps: Snapshot[], method, cfg): Lines0920 | null` (first snapshot at or after 09:20:00 IST; later snapshots cannot change it) with `{ frozenAt; eor; eorPlus1; eorPlus2; eos; eosMinus1; eosMinus2; bearishAllowed: boolean; bullishAllowed: boolean; profiles: { risky: Entry[]; moderate: Entry[] } }`, `Entry = { side: 'short'|'long'; entry: number; stop: number; target: number | null; riskPoints: number }`; `weeklyRange(cmp: number, ce: number, pe: number, opts: { lateStart: boolean }): { s: number; l1: [number, number]; l2: [number, number]; l3: [number, number]; lateStart: boolean }`.

- [ ] **Step 1: tests:** weekly range from the brief: `CMP 23432.20, CE 163.10, PE 121.05 -> S 284.15, L1 23148.05 / 23716.35, L2 22863.90 / 24000.50, L3 22579.75 / 24284.65` to 2 decimals; late start sets the flag; freeze: lines computed at the 09:20 snapshot do not change when a later snapshot differs; a missing EOR or EOR+1 sets `bearishAllowed: false` (no short entries), a missing EOS or EOS-1 sets `bullishAllowed: false`; risky entries are EOR short / EOS long, moderate are EOR+1 / EOS-1; stop is `EOR+2 + 10` for shorts and `EOS-2 - 10` for longs; targets are the put-side reversal at the entry strike for shorts and the call-side reversal for longs; `riskPoints = |stop - entry|`.
- [ ] **Step 2 to 5:** FAIL, implement, PASS, commit.

### Task 11: `analyzeSession`, replay determinism

**Files:** Create `lib/ltp/analyze.ts`; Test `tests/ltp/analyze.test.ts`; fixture `tests/fixtures/ltp/synthetic-day.json` (built with `makeChain`, 376 snapshots).

**Interfaces:**
- Consumes: Tasks 2 to 10.
- Produces: `analyzeSession(snaps: Snapshot[], opts: { now: number; method?: ExtensionMethod; cfg?: LtpConfig }): SessionAnalysis` with `{ levels; strength; events; coa1; coa2; diversions; soc; lines0920; hits; flags }` for the latest snapshot plus the series the charts need.

- [ ] **Step 1: tests:** `running analyzeSession twice on the fixture day returns deep-equal output`; with `now` before 09:45 the COA 2.0 field is `outside_window`; with an empty list it returns an explicit `{ empty: true }`, not an exception; a snapshot list in the wrong order is sorted by `ts` (documented).
- [ ] **Step 2 to 5:** FAIL, implement, PASS; run the full suite `npx vitest run` and show the output; commit. **STOP: milestone 1 summary, wait for your go-ahead.**

---

## Milestone 2: Adapter and recorder

### Task 12: Chain normaliser and the broker wrapper method (A)

**Files:** Modify `lib/screener/broker/fyers.ts` (add `optionChain` to the object `createFyersAdapter` returns, typed as `FyersAdapter = BrokerAdapter & { optionChain(...) }`); Create `lib/ltp/chain.ts`; Test `tests/ltp/chain.test.ts` (uses `tests/fixtures/ltp/nifty-chain.json` from Task 0).

**Interfaces:**
- Produces: `parseChain(raw: unknown, ctx: { underlying: string; snapshotTs: number; latencyMs: number; strikecount: number }): ParseResult` where `ParseResult = { ok: true; snapshot: Snapshot; warnings: string[]; missing: string[] } | { ok: false; reason: 'login_required'|'upstream'|'empty'|'malformed'; message: string }`; `deriveStep(strikes: number[]): number | null` (most common difference); `nearestExpiry(expiries: string[], nowIst: Date): string`; `adapter.optionChain(underlying: string, strikecount?: number): Promise<BrokerResult<unknown>>` with retry and exponential backoff on 429/5xx (reusing the wrapper's `call`).

- [ ] **Step 1: tests:** the real fixture parses to rows with `side`, `strike`, `ltp`, `oi`, `oiChange`, `volume`, `spot`; step 50 is derived for NIFTY and a warning is logged if it differs from the expected value for that underlying; a missing field becomes `null` and its name appears in `missing`; today's expiry is still chosen at 15:29 IST and the next one at 15:31; a 429 is retried and a persistent failure returns `{ ok: false }` with the reason, never previous data; the token never appears in any message.
- [ ] **Step 2 to 5:** FAIL, implement, PASS; run `tests/safety` and show it passing; commit.

### Task 13: Store schema

**Files:** Create `drizzle/0008_ltp.sql`, `lib/ltp/store.ts`; Modify `db/schema.ts`, `tests/migrate-local.test.ts` (migration list); Test `tests/ltp/store.test.ts`.

**Interfaces:**
- Produces: tables `ltp_snapshots` (PK `underlying, expiry, snapshot_ts, strike, side`; plus `trade_date`, `ltp`, `oi`, `oi_change`, `volume`, `spot`, `fetch_latency_ms`, `flags`), `recorder_gaps(underlying, minute_ts, reason)`, `ltp_lines_0920(trade_date, underlying, json)`, `ltp_weekly_range(week_start, underlying, json)`, `ltp_calibration(...)`; `LtpStore` with `insertSnapshot(s: Snapshot): Promise<{ inserted: number }>` (`INSERT OR IGNORE`, rows grouped to stay under D1's 100 bound values), `snapshotsForDay(underlying, date): Promise<Snapshot[]>`, `latest(underlying)`, `addGap(...)`, `gapsForDay(...)`, `saveLines0920/getLines0920`, `saveWeekly/getWeekly`.

- [ ] **Step 1: tests (D1 fake):** inserting the same snapshot twice leaves one row per key (second call reports 0 inserted); `snapshotsForDay` returns time-ordered snapshots equal to what was inserted; partitioned reads by `trade_date` and underlying; gaps round-trip.
- [ ] **Step 2 to 5:** FAIL, implement (and run `node scripts/migrate-local.mjs`), PASS, commit.

### Task 14: Recorder (B)

**Files:** Create `lib/ltp/recorder.ts`, `app/api/ltp/record/route.ts`, `scripts/ltp-recorder.ts`; Test `tests/ltp/recorder.test.ts`.

**Interfaces:**
- Consumes: `parseChain`, `LtpStore`, `HOLIDAYS`.
- Produces: `isRecordingMinute(now: Date): boolean` (NSE trading day, 09:15:00 to 15:30:00 inclusive, not a listed holiday); `recordOnce(deps: { adapter; store; now: () => Date; underlyings: string[]; strikecount: number }): Promise<RecordSummary>` with per-underlying `{ inserted; gap?: string }`; `health(store, now): Promise<{ lastSuccessTs; snapshotsToday: Record<string, number>; gapsToday: number; badge: 'green'|'amber'|'red' }>` (green under 2 minutes, amber under 5); CLI commands `record-once`, `run` (loop at each minute boundary, posting to `/api/ltp/record`), `replay --date YYYY-MM-DD --underlying X` (writes CSV, see Task 15).

- [ ] **Step 1: tests:** Review Focus 4: `recordOnce` run twice for the same minute leaves no duplicates; a simulated FYERS failure writes a gap row with its reason (`upstream`, `login_required`) and zero snapshot rows (no fake data); 09:14:59 and 15:30:01 and a listed holiday are not recording minutes, 09:15:00 and 15:30:00 are; one underlying failing does not stop the others; `health` gives green at 90 s, amber at 4 min, red at 6 min and counts gaps.
- [ ] **Step 2 to 5:** FAIL, implement, PASS; show `npx vitest run tests/ltp`; commit.

### Task 15: Replay command

**Files:** Modify `scripts/ltp-recorder.ts`; Test `tests/ltp/replay.test.ts`.

**Interfaces:** `replayDay(store, underlying, date, cfg): Promise<string>` returns the CSV text (one row per snapshot: time, spot, support, resistance, statuses, pct values, COA 1.0 number, COA 2.0 outcome, SOC); the CLI writes it to `data/ltp_replay/<date>-<underlying>.csv`.

- [ ] **Step 1: tests:** replaying a stored synthetic day twice produces byte-identical CSV; an unknown date reports "no snapshots stored for that day".
- [ ] **Step 2 to 5:** FAIL, implement, PASS, commit. **STOP: milestone 2 summary (including a real `record-once` run against FYERS if you are logged in), wait for your go-ahead.**

---

## Milestone 3: UI

### Task 16: State route and calibration (D)

**Files:** Create `app/api/ltp/state/route.ts`, `app/api/ltp/calibration/route.ts`, `lib/ltp/calibration.ts`; Tests `tests/ltp/calibration.test.ts`, `tests/ltp/state.test.ts`.

**Interfaces:**
- Produces: `GET /api/ltp/state?underlying=&date=` returning `{ health; snapshotTs; analysis: SessionAnalysis; chainRows; spotSeries; flags } | { empty: true; reason: 'no_data_yet' }`, falling back to the latest stored day when the market is closed; `POST /api/ltp/calibration` (underlying, time, actual EOS/EOR and optional EOS-1/EOR+1) storing the proxy value from the nearest snapshot within +/- 1 minute under each `ExtensionMethod`; `calibrationSummary(entries): Record<methodId, { n; meanAbsError; medianError; errorInSteps }>` (reports only, never adjusts anything).

- [ ] **Step 1: tests:** Review Focus 5: no snapshots returns `{ empty: true }`, a stale recorder gives a red badge, a closed market returns the last stored day; calibration: entry at 10:00 with no snapshot within 1 minute is rejected with a message; mean absolute error, median error and error in steps are exact on a hand-computed set of 3 entries for both methods.
- [ ] **Step 2 to 5:** FAIL, implement, PASS, commit.

### Task 17: The tab

**Files:** Create `app/ltp-tab.tsx` plus `app/ltp-chain-table.tsx`, `app/ltp-charts.tsx`; Modify `app/page.tsx` (register "LTP Levels"); Test `tests/ltp/view.test.ts` for pure view helpers (`highlightCells`, `healthBadge`, `windowLabel`).

**Interfaces:** Consumes `GET /api/ltp/state` and `POST /api/ltp/calibration`. Sections in the order of the brief's E: header (underlying selector, expiry, spot, last snapshot, health badge, time-window label), levels strip, scenario cards, 9:20 panel, weekly range, chain table around ATM (highest value per column in one colour, the "yellow box" for the second-highest above 75%, the imaginary line marked, reversal values per strike), three charts (spot with EOS/EOR/9:20 lines; weakness % per side and metric with the 75% line; CE OI at resistance and PE OI at support since 09:15), level-shift log, calibration form and summary, footer disclaimer. Every proxy value is labelled. Refresh every 60 s from the store only. Plain hex colours and an error boundary for the chart (the library cannot parse `oklch`).

- [ ] **Step 1: tests:** `highlightCells` marks the maximum per column and the second-highest only when its pct exceeds 75; `healthBadge` boundaries at 2 and 5 minutes; `windowLabel` returns before 09:45 / COA 2.0 valid / after 14:30 at the boundaries.
- [ ] **Step 2 to 5:** FAIL, implement, PASS; run the full suite and `npx tsc --noEmit` and `npx oxlint` for the new files; check the tab in the browser against a stored synthetic day (market closed) and, if you are logged in during market hours, against live data; commit. **STOP: milestone 3 summary, wait for your go-ahead.**

---

## Milestone 4: Docs

### Task 18: `docs/ltp-levels.md`

**Files:** Create `docs/ltp-levels.md`.

- [ ] **Step 1:** write each rule with its brief section (C1 to C10, A, B, D, E), then a "proxy or assumed" list (EOS/EOR method, COA 2.0 band and lookback, SOC range interpretation, SENSEX handling, the C3 combining interpretation, 15:30 inclusive), how to run `record-once`, `run` and `replay`, the `.env.local` token requirement and its daily expiry, and what a backtest needs (at least 20 recorded sessions; the backtest itself is out of scope for v1).
- [ ] **Step 2:** run the full suite and show the output; commit `docs: LTP levels`. **STOP: final summary.**

## Self-review

- **Spec coverage:** A -> Tasks 0, 12; B -> Tasks 13, 14, 15; C1/C2 -> 2; C3 -> 3; C4 -> 4; C5 -> 5; C6 -> 6; C7 -> 7; C8 -> 7; C9 -> 9; C10 -> 9; D -> 16; E -> 17; F golden tests -> the named tests in Tasks 2 to 11 (COA 1.0 table, diversions, weekly range, 75% boundary, shift sequence, imaginary line, tie-break, COA 2.0, SOC, 9:20 freeze, writer_breakeven, recorder, replay); G -> 18.
- **Types:** `Snapshot`, `Status`, `MetricPick`, `SideLevel`, `StrengthPoint`, `ExtensionMethod` are defined once (Tasks 1 to 4) and used with the same names later.
- **Gaps I could not close from the brief alone:** the real chain field names and BSE/SENSEX availability (Task 0), and the numbers in the C3 combining examples beyond the shift sequence given; the plan asks you to confirm the interpretation in decision 6.
