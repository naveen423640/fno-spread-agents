# Phase 0 gate record

Date: 2026-10-03. Branch `phase-0-1`. This page consolidates the audit docs `01` to `05` in this folder. It adds no new research: every classification below points to the audit text that supports it. Where an audit item waits for the user, it is marked "pending user" and nothing is called verified.

Classes: verified / documented-untested / needs adaptation / unsupported. "pending user" means the evidence needs an action only the user can do.

**Gate decision (details below): REPAIR, with Phase 1 start conditional on the user's answers.** It is not an unconditional "continue".

## 1. Spec section 0: checks resolved

| # | Assumption | Class | Evidence | Change forced |
|---|---|---|---|---|
| 0.1 | Heat map universe is a static list; unclear which tickers historical mode uses | verified (code read) | Plan "Already done": historical mode also filters by the static `marketSnapshot` list (`app/api/market/route.ts`, `fetchHistorical`). Live mode also static (spec section 0). | Replace the static universe with a dated universe in Phase 1 (already planned there). |
| 0.2 | "FYERS live" label shown when market closed | verified fixed | commit `d085cbd`; `lib/market-session.ts` and `tests/market-session.test.ts` | None remaining. |
| 0.3 | Hardcoded date 2026-08-31 | verified fixed | commit `a279b47` (also added vitest) | None remaining. |
| 0.4 | No real order paths | verified | Fail-closed guard and no-order-endpoint tests, see section 4 | None. |
| 0.5 | Reuse classification table | documented-untested | Spec section 0 (code read on 2026-09-29, not re-audited here) | Costs row: see 03-costs below. |

## 2. Spec section 12 (items 1 to 8)

| Item | Assumption | Class | Evidence | Change forced |
|---|---|---|---|---|
| 12.1a | FYERS token lifetime | documented-untested (pending user) | `04-fyers.md` section 1: documented as daily ("expires end of trading day"); exact expiry instant unverified; never observed | None to code yet; keep `FNO_TOKEN_MAX_AGE_HOURS` 8 (conservative, within daily). User supplies login and first-failure times (item b below). |
| 12.1b | Refresh without manual login | needs adaptation | `04-fyers.md` section 1: refresh token 15 days documented, but FYERS notice (SEBI framework, from 2026-04-01) says 2FA once every trading day and continuous refresh sessions end | Plan for a manual login every trading day; no unattended refresh. The spec section 3.1 manual login design already matches. |
| 12.1c | What the engine sees on expiry (error codes) | documented-untested; partly contradicted | `04-fyers.md` section 2: documented codes -8, -15, -16, -17 and HTTP 401. Existing assumption "-16 and -22": -22 appears in no source read (it is used in `lib/regime/fyers-daily.ts`); -8, -15, -17 missing from it | Treat -8, -15, -16, -17 and 401 as token-expired in the engine. Review the "-22" use in `lib/regime/fyers-daily.ts` (not edited here). Observed code pending user. |
| 12.1d | Historical depth | documented-untested | `04-fyers.md` section 3: 366 days per request for daily (FYERS staff post 2024-12-04, FyersDev refs); minute data 100 days per request, from 2017-07-03; chunk requests | Daily fetch must chunk by 366 days. Probe pending user. |
| 12.1e | Expired futures and options history | unverified (pending user probe) | `04-fyers.md` section 3: not documented anywhere read; `EXPIRED_OPTION_HISTORY_UNAVAILABLE` stands | Do not depend on FYERS for expired contracts. NSE archives are the history source (Phase 1). |
| 12.1f | Symbol mapping | documented-untested | `04-fyers.md` section 4: equity, index, futures, monthly option formats documented; bhavcopy names have the same shape, but acceptance by FYERS is not proven | Validate constructed symbols with `/quotes` or the symbol master before use. |
| 12.1g | Rate limits | documented-untested | `04-fyers.md` section 5: 10/s, 200/min, 100,000/day; breaching the per-minute limit more than 3 times a day blocks the account for the day; whether history counts is unstated | Engine client must throttle below 10/s. Burst probe pending user. |
| 12.1h | WebSocket behaviour and reconnects | not audited | Not covered by `04-fyers.md` | Needed before Phase 4; not a Phase 1 blocker. |
| 12.1i | Official docs source | recorded limitation | `04-fyers.md` source caveat: the official docs site returned 404 to the fetch tool; facts come from FYERS's GitHub skills refs, official notices and community posts | All FYERS facts are secondary or documented-only until the probe runs. |
| 12.1j | Old API apps after 2026-04-01 | documented | `04-fyers.md` section 1: old apps are data-only; new app needs a static IP | Check the user's app type. Data-only is enough for Phase 0 to 4. |
| 12.2a | NSE archive coverage, F&O daily | verified | `01-nse-archives.md` sections 2, 3, 6: UDiFF pattern works from 2024-01-01 (FO and CM); same 34-column header in the 2024-10, 2025-10, 2026-04 and 2026-10 samples | Earliest usable date 2024-01-01. Parsers key columns by name. |
| 12.2b | Format eras | verified | `01` section 3: 2024-01-02 differs only in `Rsvd01..04` naming (and one extra empty CM column); change date not bisected | Ignore `Rsvd*` columns. |
| 12.2c | Futures (`STF`) rows carry usable OI | verified | `01` section 2: `OpnIntrst` non-zero on 621/621 traded STF rows; `ChngInOpnIntrst` 608/621; IDF 14/14 | Futures OI is usable for the signal. Parser must read STF and IDF (current parser reads options only). |
| 12.2d | Bhavcopy publication time (`BHAVCOPY_PUBLISHED_AFTER`) | verified (mtime evidence); first-availability moment unverified | `01` sections 1 and 6: 19:00 IST contradicted (4 of 15 FO files modified later; max 22:16:01 IST on 2026-09-28). Cash file 16:33 to 16:39 IST | Rule set to 22:30 IST in `engine/src/fnoengine/ist.py`. The plan Decision 2 default of 19:00 IST is superseded. User approval needed (item f). |
| 12.2e | Ban list URL and format | verified | `01` section 4: `.../archives/fo/sec_ban/fo_secban_{DDMMYYYY}.csv`; title line then `serial,SYMBOL` rows; no-ban day is one line ending `: NIL`; for trade date T the file is published the evening before T (up to 19:31 IST observed) | Do not apply the bhavcopy rule to it. Whether files are revised intraday is unverified. |
| 12.2f | Heat-map historical tickers | verified | see 0.1 | Phase 1. |
| 12.3 | Indian cost rates and change dates | verified for dates from 2024-10-01 (Standard brokerage plan); documented-untested for clearing, stamp duty and the pre-2024-10 exchange rate; contradicted for IPFT before 2023-04-01 | `03-costs.md` constants table and Findings 1 to 4 | Costs module is not moved to a dated config until Phase 3 (plan Decision 1). Treat pre-2024-10 cost-aware results as approximate. Optional user check: one actual contract note. GST-on-SEBI-fee conflict between two FYERS pages is negligible (about Rs 1.8 per crore). Exercise/expiry STT is not modelled (square-off only). |
| 12.4 | Legally and reliably accessible Indian news, filings, fundamentals and calendars | unsupported (NSE automated collection); needs adaptation (Google News RSS); unverified (BSE, Screener, Yahoo, SEBI) | `05-later-phases.md` section 1: NSE Terms of Use (updated 2025-10-29) prohibit automated data collection and use of content for "virtual trading or simulation"; Google News `robots.txt` disallows the RSS path for generic crawlers; BSE page returned 403 | A2 News and Fundamentals analysts have no confirmed source. User decision (item c). The planned archive downloads are affected too, see inconsistency 6 in section 5. |
| 12.5a | TradingAgents fork | superseded by A2 | Spec A2 | None. |
| 12.5b | Free LLM providers and terms | documented-untested | `05` section 2: Groq (8K TPM small), Gemini free tier (prompts may be used for training), OpenRouter (50/day without credits), Cerebras (base URL unverified); at least three give OpenAI-compatible endpoints | The `lib/llm/` fallback-list design is feasible. User must choose providers (item e). JSON-schema reliability across free models unverified. |
| 12.5c | Apache-2.0 notice | verified (licence name); notice mechanics unverified | `05` section 2: GitHub shows Apache-2.0; LICENSE text not read | Header comment plus licence copy on any adapted prompt text; read the LICENSE before relying. |
| 12.6 | Paperclip on the user's OS | documented-untested; needs adaptation on Windows | `05` section 3: Node 24.11+, docs list macOS, Linux, WSL2; native Windows not mentioned; HTTP adapter blocks localhost unless allowlisted; cron scheduling unconfirmed | Use WSL2 or the app's own scheduler. Decide in the agent-team plan. Not a Phase 1 blocker. |
| 12.7 | Paper capital and slippage per leg | pending user (not decided) | `05` section 4 lists the questions; no source to calibrate slippage (needs a measured bid/ask sample) | User answers (item d). |
| 12.8 | SEBI and broker requirements for future live API trading | documented (FYERS official) / documented-untested (SEBI circular via secondary summaries) | `05` section 5 | Informational; paper trading unaffected. A live path needs a static IP, daily login, new app. |

## 3. Plan "Decisions taken" (1 to 8)

| # | Decision | Class | Evidence | Change forced |
|---|---|---|---|---|
| D1 | Cost constants verified in Phase 0, dated config in Phase 3 | verified (the audit was done) | `03-costs.md` | Results mixed, see 12.3. |
| D2a | Bhavcopy rule "after 19:00 IST" | contradicted | `01` sections 1 and 6 | Changed to 22:30 IST. Plan text still shows 19:00 (inconsistency recorded; evidence wins). |
| D2b | Ban file `fo_secban_DDMMYYYY.csv` | verified | `01` section 4 | None; add the forward-looking publication note. |
| D2c | Token treated as expired after 8 h | documented-untested | `04` section 1 | Keep; confirm with user timing. |
| D3 | Engine venv Python 3.14 | verified (engine scaffold exists, `20 passed` recorded in `01` section 1) | commit `8f73c53`; `01` section 1 | Known follow-up: `engine/requirements.lock` has a BOM and an absolute editable-install line. Regenerate with `pip freeze --exclude-editable` (no BOM) before merge. |
| D4 | Token file under `%USERPROFILE%\.fno-engine`, Windows ACLs not enforced | documented-untested (design decision, no audit evidence needed or gathered) | Plan Decision 4 only | Stated limitation stands. |
| D5 | Dashboard calls engine server-side on 127.0.0.1:8765 | not audited (design) | Plan Decision 5 | Built and tested in Phase 1. |
| D6 | Corporate actions from a user-verified CSV | verified as the right fallback | `05` section 1: no reliable automated source confirmed; SEBI/exchange filings not researched | Keep the CSV route. |
| D7 | Dynamic heat map header; Markov tab keeps static list | not audited (design) | Plan Decision 7 | Listed follow-up. |
| D8 | User verifies `reference/nse_holidays.json`; engine refuses `verified: false` | pending user | `02-holidays.md`: file has `"verified": false`; feed read from NSE `holiday-master`; 0 mismatches on 126 weekdays and 7 holidays (2026-04-01 to 2026-10-02); 13 of 14 2025 weekday holidays returned 404 and 2025-10-21 returned 200 | 2025-10-21 (Diwali Muhurat) is left out of `holidays` and must be treated as a modified-hours day. Holidays before April 2026 and after 2026-10-02 not probed. Page-to-feed link inferred. |

## 4. Safety status

- Fail-closed execution-mode guard, TypeScript: commit `0ed9625` (`lib/execution-mode.ts`). `tests/execution-mode.test.ts` covers: defaults to paper with live off; accepts the explicit safe values; refuses any other mode including near misses; refuses any live-execution value other than the exact string `false`.
- No-order-endpoint scan, TypeScript: same commit, `tests/safety/no-order-endpoints.test.ts`. It asserts application source references only allowed FYERS auth and data endpoints, and a second test proves the scanner can fail (it catches an injected order endpoint).
- Python mirror: commit `8f73c53` (engine scaffold, execution-mode guard, IST helpers). `engine/tests/test_safety.py` and `engine/tests/test_no_order_endpoints.py` mirror the same four checks plus a scanner-can-fail test. `engine/tests/test_ist.py` covers IST helpers. The audit `01-nse-archives.md` records `20 passed` for `engine/tests` after the 22:30 change (commit `8ade56e`). I did not re-run the test suites for this record.
- What these tests prove: the guard rejects any value other than paper and `false`; no source file in the app or the engine mentions a FYERS order endpoint at the time of the scan. What they do not prove: the absence of order calls built dynamically at runtime, or in dependencies, or in tools outside the scanned source.
- Not verified here: no live FYERS call has been made by anyone but the user; the assistant made none (`04-fyers.md` status line).
- Other commits relevant to the gate: `a279b47` (date fix, vitest), `d085cbd` (label fix), `4a18d28` and `173e960` (spec A2 and plan alignment), audit commits `8ade56e`, `7437171`, `f09da6e`, `fec6420`.

## 5. Inconsistencies noted (not silently resolved)

1. Plan Decision 2 still says "after 19:00 IST"; `01-nse-archives.md` contradicts it and the code is already 22:30 IST. The plan text was not edited.
2. Spec section 6 says rates are "verified against official sources in Phase 0"; the audit shows only part of them are (clearing, stamp duty, and the pre-2024-10 exchange rate are broker-sourced or approximate).
3. Spec section 12.2 says only options rows are parsed today; the audit confirms STF and IDF rows exist with OI, so the parser must be extended (Phase 1).
4. `01-nse-archives.md` reports 2026-09-14 and 2026-10-02 FO 404 with "reason not checked"; `02-holidays.md` lists both as NSE holidays, which explains them. Consistent, but the 2026-09-14 and 2026-10-02 holiday status comes only from the feed.
5. `lib/regime/fyers-daily.ts` treats code "-22" as an auth failure; no source read lists it (`04-fyers.md` section 2).
6. The NSE terms finding (`05` section 1) applies to the NSE archive downloads in audit 01, which the audit itself used as the main data source; it reads the aggregation clause as excepted for downloadable files but the simulation clause as still applicable. This is not legal advice.

## 6. CEO / CFO / CTO findings

- **CEO:** The question the project asks (does trend + OI on futures give an edge after costs) can be answered with free NSE archive data from 2024-01-01 (about 2.7 years), and futures OI is confirmed present; but the data licence status under the NSE Terms of Use is unresolved, and a paper-trading simulation is the very use the terms name as restricted.
- **CFO:** Costs from 2024-10-01 are verified against NSE and SEBI sources and the broker; clearing, stamp duty and the earlier-period exchange rate are not, so any result before 2024-10 is approximate. Free LLM tiers are small (Groq 8K TPM, OpenRouter 50/day without credits) and Gemini free prompts may be used for training, so the agent step can fit only on-demand use at Rs 0 and a daily batch will hit caps.
- **CTO:** The data layer is feasible (stable file format across the tested eras, ban list and holiday cross-checks pass), safety guards exist in both languages, and the publication-time rule had to be corrected to 22:30 IST. FYERS behaviour (expiry, expired-contract history, 366-day cap, rate limits) is documented only; the first live observation is the user's probe. Two follow-ups before merge: regenerate `engine/requirements.lock`, and review the "-22" code.

## 7. Recommended decision: REPAIR (conditional continue)

Why not continue outright: (a) the NSE Terms of Use finding is unresolved and Phase 1 ingests NSE archives; (b) the holiday list is unverified by the user; (c) no FYERS fact has been observed. Why not simplify or stop: the data audit succeeded with evidence, the safety guard exists and the cost model is verified for the default period.

Conditional on the user:
- Phase 1 may start only after the user approves, and after answering (c) on the NSE terms (licence, accept the risk, or change source). If the user chooses to change sources, Phase 1's scope changes and this gate should be re-run.
- Phase 1 data-layer work does not need the FYERS probe, the LLM provider choice or the capital and slippage answers; those block Phase 2 onward, the agent-team plan, and engine-side FYERS auth testing respectively.
- Engine code must refuse `reference/nse_holidays.json` while `verified` is false for production runs (plan Decision 8); leaving it unverified keeps Phase 1 work in non-production mode.

## 8. Decisions and confirmations needed from the user

1. **Holiday list.** Compare `reference/nse_holidays.json` with the official NSE holiday page, then set `"verified": true` and record who confirmed and when in `docs/audit/02-holidays.md`, section "Pending user confirmation". Also confirm how to treat the 2025-10-21 Muhurat day.
2. **FYERS probe.** In your own PowerShell, run `scripts/probe-fyers.mjs` as described in `docs/audit/04-fyers.md`, section "Probe: how to run it", and paste the output (no token) under "Pending user run". Also note the local time of the login that created the token and the time, HTTP status and `code` of the first auth failure next day. The assistant does not run it and does not need your token.
3. **NSE Terms of Use.** Decide how to proceed given `docs/audit/05-later-phases.md` section 1 (automated collection and "simulation" use are restricted; Phase 1 ingests NSE archives): get an NSE data licence, accept the risk knowingly, or change sources. Also decide what to do for the news and fundamentals sources (licensed vendor, pasted text, FYERS-only data, or accept the risk).
4. **Paper capital and slippage.** Answer the questions in `docs/audit/05-later-phases.md` section 4: account size (Rs 5 to 25 lakh, spec section 2), sizing basis and per-trade risk percent, and slippage per leg (flat Rs 0.05 per unit today; options a to d listed there).
5. **Free LLM providers.** Choose which to use (Groq, Gemini, OpenRouter, Cerebras; see `05` section 2), knowing the free-tier data-use and quota notes. Needed for the later agent-team plan, not for Phase 1.
6. **Publication-time rule.** Approve or change the 22:30 IST bhavcopy rule (`docs/audit/01-nse-archives.md` section 1; `engine/src/fnoengine/ist.py`). A tighter 20:00 IST covers 14 of 15 observed days but not the 2026-09-28 outlier.
7. **Start Phase 1.** Approve starting Phase 1 (plan tasks 7 to 19), given the answers above. Also acknowledge the pre-merge follow-up: regenerate `engine/requirements.lock` with `pip freeze --exclude-editable` (no BOM).
