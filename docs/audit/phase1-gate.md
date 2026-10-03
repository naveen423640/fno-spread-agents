# Phase 1 gate record

Date: 2026-10-03. Branch `phase-0-1`. Spec section 11, Phase 1 gate: "Leakage and integrity tests pass; data-layer oracle parity". This page records fresh verification runs and what they do and do not prove.

**Headline: Phase 1 is built and unit-verified on synthetic data. Real-data validation (Task 18) was NOT RUN: it is held pending user decisions (NSE Terms of Use, holiday calendar confirmation). Everything that depends on real archives is marked "NOT RUN: held pending user decisions" below, and no synthetic result is substituted for it.**

## 1. Fresh verification runs (2026-10-03, from the repo root)

| Command | Result (summary lines as printed) |
|---|---|
| `npx vitest run` | `Test Files  15 passed \| 1 skipped (16)`, `Tests  178 passed \| 1 skipped (179)`; exit 0. The one skipped file is `tests/oracle/dump.oracle.test.ts`, an environment-driven helper (`describe.skipIf(!archive \|\| !out \|\| !today)`) that the Python parity test launches itself; it is skipped on a plain run by design. |
| `npx tsc --noEmit` | no output; exit code 0 |
| `npm run build` | `Build complete. Run \`vinext start\` to start the production server.`; exit code 0 |
| `npm run lint` | exit 1, 29 errors (counted: 29 lines containing ` error `). Matches the stated baseline of 29. Errors by file: `app/page.tsx` 8, `app/strategy-lab.tsx` 2, `components/ui/*` 18 (breadcrumb 1, button-group 1, carousel 3, chart 3, field 1, input-group 4, input-otp 1, item 1, label 1, pagination 1, spinner 1), `hooks/use-mobile.ts` 1. None are in `lib/engine-client.ts`, `lib/universe.ts`, `lib/execution-mode.ts` or any `tests/` file (grep of the output for those names returned nothing). |
| `engine/.venv/Scripts/python -m pytest engine/tests -q -rs` | `137 passed, 1 warning in 25.63s`; exit 0. No `SKIPPED` line in the `-rs` summary (zero lines containing "skip"). The warning is a Starlette/anyio deprecation inside the venv. |
| `pytest engine/tests/test_oracle_parity.py -v -rs` (extra run to name the parity tests) | `test_python_matches_the_typescript_oracle_on_a_synthetic_archive[3]` PASSED, `...synthetic_archive[50]` PASSED, `test_python_matches_the_typescript_oracle_on_a_rich_archive[3]` PASSED, `...rich_archive[50]` PASSED; `4 passed in 15.07s`; no skips. The test spawns node, so node was present. |

## 2. Safety verification

(a) No-order-endpoint tests pass in both languages (both ran inside the runs above):
- Python: `engine/tests/test_no_order_endpoints.py::test_engine_source_references_no_order_endpoints` and `::test_scanner_catches_violations`.
- TypeScript: `tests/safety/no-order-endpoints.test.ts`, `the application source references only allowed FYERS auth and data endpoints` and `the scanner itself catches an order endpoint (it can fail)`.

(b) Live mode refuses to start. Python, run once with variables set only for that process:

```
EXECUTION_MODE=live          -> LiveExecutionRefused EXECUTION_MODE must be "paper" (got "live"). Live execution is disabled in this system.
LIVE_EXECUTION_ENABLED=true  -> LiveExecutionRefused LIVE_EXECUTION_ENABLED must be "false". Live execution is disabled in this system.
```

TypeScript `readExecutionSettings` is covered by the existing tests in `tests/execution-mode.test.ts` (`refuses any other mode, including near misses`, `refuses any live-execution value other than the exact string false`); they passed in the vitest run. Python equivalents: `engine/tests/test_safety.py` (`test_refuses_any_other_mode`, `test_refuses_any_live_value_but_exact_false`). No environment variable was set permanently.

(c) `git ls-files | grep -c "^\.env"` printed `0`.

(d) Token and `.env` handling, by search over `engine/src`, `lib/engine-client.ts`, `lib/universe.ts`, `lib/execution-mode.ts`:
- `FYERS_ACCESS_TOKEN`: no matches anywhere in those paths.
- `access_token`: only `engine/src/fnoengine/auth/login.py` (reads it from the FYERS token-exchange response) and `engine/src/fnoengine/auth/token_store.py` (the stored record; its `repr` masks the token as `'***'`).
- `.env` matches are all `os.environ` / `process.env` reads, not file reads: `auth/login.py` (`FYERS_CLIENT_ID`, `FYERS_SECRET_KEY`, `FYERS_REDIRECT_URI` from the process environment, and the token max age), `auth/token_store.py` (token path from the environment), `safety.py` (`EXECUTION_MODE`, `LIVE_EXECUTION_ENABLED`), `lib/engine-client.ts` (`FNO_ENGINE_URL`), `lib/execution-mode.ts` (the two safety flags). No code opens a `.env*` file.
- Files that mention tokens without handling the secret: `engine/src/fnoengine/api.py` (reports token status only, via `TokenStore.status` / `expiry_note`) and `engine/src/fnoengine/gates.py` (acts on a `TokenStatus`, no token value).
- So token handling exists only in `engine/src/fnoengine/auth/*`. Limit: this is a text search; the secret key and redirect URI are expected in the engine's process environment, which was never inspected. No `.env*` file or real token file was opened or printed in this task.

## 3. Gate checklist (spec section 11, Phase 1, plus the plan's scope)

Status: done / done with limits / NOT RUN.

| Item | Evidence | Status |
|---|---|---|
| Point-in-time reads, including revisions (superseded rows kept, Ruling 10) | `engine/tests/test_leakage.py`, `engine/tests/test_store.py` | done with limits: synthetic and committed-sample data only. Leakage spot-check on real stored dates: NOT RUN: held pending user decisions. |
| Integrity checks | `engine/tests/test_integrity.py` | done with limits: synthetic data; real-data open-interest share and real integrity results: NOT RUN: held pending user decisions. |
| Calendar | `engine/tests/test_calendar.py` | done with limits: logic tested; `reference/nse_holidays.json` is `verified: false` pending the user, and the cross-check of the calendar against real archives is NOT RUN: held pending user decisions. |
| Ban list and corporate actions (strict layout and validation, Ruling 12) | `engine/tests/test_banlist.py`, `engine/tests/test_corporate_actions.py` | done with limits: ban list tested against the committed real sample; no real corporate-actions data was loaded in this gate. |
| Engine FYERS auth, token store, incidents, entry gate, ingest | `engine/tests/test_token_store.py`, `test_login.py`, `test_gates.py`, `test_incidents.py`, `test_ingest.py` | done with limits: tested with fake transports. The live FYERS login flow and the token lifetime have never been run (probe pending the user). Real-data ingest counts: NOT RUN: held pending user decisions. |
| Read-only local API, including the concurrency lock (Ruling 14) | `engine/tests/test_api.py` | done |
| Dated universe in the dashboard with a visible fallback | `tests/universe.test.ts`, `tests/engine-client.test.ts` (passed in the vitest run above); the implementer reported a dev-server check; no evidence file backs it and it is unverified here | done with limits: dev-server check not repeated here; the Markov tab still uses the static universe |
| Oracle parity, synthetic | `engine/tests/test_oracle_parity.py` (4 passed, section 1), `docs/audit/oracle-parity-data.md` | done: Python data layer matches the TypeScript oracle on the synthetic homogeneous and rich archives. |
| Oracle parity, real data | none | NOT RUN: held pending user decisions |
| No-order-endpoint tests and live-mode refusal, both languages | section 2 | done |

What the synthetic evidence DOES show (synthetic only): the Python universe, lot-size and cycle logic reproduces the TypeScript logic exactly on generated archives built to exercise tie-breaks, several expiries in a month, options without futures and a holiday at the probe start; point-in-time reads do not leak rows published after the as-of time, and revised files do not rewrite history. It does not show that the real NSE archives parse or integrity-check the same way across the full history.

## 4. Controller rulings that changed the plan during Phase 1



Scope of approval (Ruling 8): the user's "continue with phase 1" approved starting Phase 1 only. The other Phase 0 gate items (a to f) remain open until the user answers them.
| Ruling | Change |
|---|---|
| 9 | Ingest treats a network error or archive error from the client as a per-day fetch failure: records one `DATA_FETCH_ERROR` incident and continues. |
| 10 | Point-in-time revisions are kept: `fo_daily` has a `revision` column; a revised file adds rows (revision = max + 1) without deleting; a revision's `available_ts` is at least its retrieval time; the reader takes the highest revision available as of the read time. |
| 11 | The synthetic generator was extended (several expiries, options without futures, tied liquidity, a holiday at the probe start) so parity cannot pass trivially. |
| 12 | `parse_ban_list` requires the recognised title line and raises on any other non-blank text (empty stays `[]`); the corporate-actions loader validates headers, strips a BOM, reports physical line numbers and requires positive finite split/bonus values. |
| 13 | Data-problem incidents are keyed per date (`DATA_GAP:`, `INTEGRITY_ERROR:`, `DATA_FETCH_ERROR:` plus the date) and resolve only when that day is later stored; the token incident is unchanged. |
| 14 | The API serialises all store, reader, incident and token access behind one lock; a test proves it. |
| 15 | In embedded-snapshot mode, zero-quote placeholder stocks are hidden and the universe note says how many; the FYERS-quote path is unchanged. |

Earlier rulings (1 to 8, including the 22:30 IST publication rule and the Task 18 hold) are in the Phase 0 gate record `docs/audit/phase0-gate.md`.

## 5. What remains unverified

1. Task 18 was NOT RUN: the bulk real-data NSE ingest and the real-data oracle parity run are held pending user decisions. So no real-data ingest counts, no calendar cross-check against real archives, no real-data open-interest share, no leakage spot-check on real stored dates, and no real-data parity.
2. Pending Phase 0 user items (`docs/audit/phase0-gate.md`, section 8): confirm the holiday list against the official NSE list (`reference/nse_holidays.json` is `verified: false`, and the CLI refuses an unverified calendar); run the FYERS probe with the user's own token (token lifetime, expired-contract history, symbol acceptance); decide the NSE Terms of Use question (the audit found clauses restricting automated collection and use of site data for simulation, docs/audit/05-later-phases.md); paper capital and slippage; which free LLM providers to use; approval of the 22:30 IST bhavcopy rule (measured on 15 files, one outlier at 22:16, first-availability instant not observed).
3. The FYERS login flow has never been run end to end; the token file permission handling on Windows is only a code comment.
4. The dev-server check of the dated universe was done by the implementer and not repeated for this gate.
5. Known gaps in the code:
   - The archive client cache never re-downloads a cached date: a corrected NSE file is never noticed unless the cache file is deleted; there is no self-heal and the stored sha256 is never verified.
   - `engine/requirements.lock` has a UTF-8 BOM and a machine-specific editable-install line; it must be regenerated with `pip freeze --exclude-editable` as UTF-8 without BOM before merge.
   - The Markov tab's `lib/regime/fyers-daily.ts` treats code -22 as an auth failure, but the audit found no source for it (documented codes are -8, -15, -16, -17 and HTTP 401).
   - The Markov tab still uses the static universe.
   - There is no `ORACLE_REQUIRED` switch, so a missing node silently skips the parity test; this gate ran with `-rs` and confirmed 4 passed.
   - The plan's Decision 2 text still says 19:00 IST; code and audit say 22:30.

## 6. Known follow-ups (deferred Minor findings, by task; summary of the review ledger)

| Task | Deferred minors |
|---|---|
| 1 | No-order scanner swallows directory errors and has coverage gaps (root files, .mts/.cjs/.jsx, bare /orders path); test asserts only a count. |
| 2 | Lock file BOM and editable line (above); scanner covers only .py; no positive/default-path safety tests; `from_utc_naive` overwrites tzinfo. |
| 3 | Audit gives counts without the inspection snippets; 22:30 rule rests on one outlier. |
| 4 | Special sessions (2025-10-21 Muhurat, 2026-11-08) only in prose; per-date probe statuses not committed. |
| 5 | Wording mismatches in the costs audit; model names unconfirmed; probe date uses UTC. |
| 6 | Gate classes outside the 4-term vocabulary; thin evidence on 0.5. |
| 7 | Short rows store OI as 0; only BadZipFile mapped to ArchiveFormatError; cash parser silent on empty. |
| 8 | Cache-hit path has no self-heal, writes not atomic; weak corrupt-archive test; transport errors escape raw. |
| 9 | Round-trip test cannot catch swaps among equal values; `fo_dates()` ignores availability; COMMIT failure can mask the error; version id is count-based. |
| 10 | Unbounded day-walk loops; add_trading_days from a non-trading day untested; weak repo-file test. |
| 11 | Tie-break differs for non-ASCII tickers; synthetic data homogeneous (partly addressed by Ruling 11). |
| 12 | `verified` accepts only `true`; duplicate action rows and empty tickers unchecked; missing BONUS and boundary tests. |
| 13 | `record_version` appended on no-op runs; a today-before-publication day raises a spurious DATA_GAP; `max(id)+1` racy; exact float compares. |
| 14 | Token file write non-atomic; naive-datetime TypeErrors; login edge cases (non-dict JSON, unencoded redirect, constant state); Windows ACL limit only a comment. |
| 15 | Naive `now()` or naive token datetimes would 500; `/openapi.json` served; `/incidents` unbounded. |
| 16 | Missing node hides that the oracle never ran; all-zero-lot ticker path not exercised. |
| 17 | Fallback note says "Engine unavailable" when the engine is up but has no data; lotSize unvalidated, duplicates not deduped; engine call on every live request (no memo); failed refresh keeps the old subtitle; untested route payload and cache key. |

## 7. Findings by role (one line each)

- CEO: The data foundation the strategy depends on exists and is tested, but nothing has yet been shown on real NSE data, and the legal question on automated NSE collection is unanswered; no claim about strategy value can be made.
- CFO: Phase 1 cost nothing in trading risk or data fees (paper only, free sources); the unresolved NSE Terms of Use question is the one potential cost or compliance exposure.
- CTO: The engine is covered by synthetic-data tests (137 Python, 178 TypeScript passing, tsc and build clean, lint at the unchanged 29-error baseline) with safety rules intact, but the cache has no self-heal, the lock file must be regenerated and real-data parity is unrun.

## 8. Recommended decision

**Repair (finish Phase 1 on real data), then continue.** Not "continue" outright, because the gate's two exit criteria (leakage and integrity, and data-layer parity) are met only on synthetic data; not simplify or stop, because nothing found contradicts the approach. The repair is: the user decides the NSE terms question and confirms the holiday list, then Task 18 runs and its real-data results are added here, and the lock file and cache-refresh issues are fixed before merge. Phase 2 does not start before that and the user's decision.

## 9. Decisions needed from the user

1. NSE Terms of Use: may the bulk NSE archive download run (Task 18)? Alternatives are a smaller sample, or another data source.
2. Confirm `reference/nse_holidays.json` against the official NSE list so it can be marked verified.
3. Run the FYERS probe with your own token (token lifetime, expired option history, symbol acceptance), or defer it.
4. Approve or change the 22:30 IST bhavcopy rule; set paper capital and slippage; choose free LLM providers (Phase 0 items still open).
5. After Task 18 results exist: approve Phase 2, or repair further.
