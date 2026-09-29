# Code review: Markov regime tab (Task 10)

- **Range reviewed:** `87ce8fe..b65f71c` (Tasks 0-7 and 9, plus the drill-down button).
- **Reviewer:** a fresh general-purpose subagent with the plan, the git range and the known limitations, no session history.
- **Verdict:** Ready to merge with fixes. No Critical findings.
- **Reviewer's own checks:** `npx vitest run` 145 passing, `npx tsc --noEmit` exit 0.

## Findings and what was done

| # | Severity | Finding | Disposition |
|---|---|---|---|
| I1 | Important | False "possibly stale" banner for any historical as-of date (`build-response.ts`); `lastCandleDate` also ignored the as-of date | **Fixed** `bd2e10b`. Staleness is only computed when the as-of date is today's session or later; `lastCandleDate` is the newest candle at or before as-of. 3 new tests (2 failed first). |
| I2 | Important | A network failure (`fetch` rejects) escaped `fetchDailyCandles` and the route, giving a non-JSON 500 and a raw parse error in the UI | **Fixed** `5b19aa4`. Returns a 502 with the fixed text "Could not reach FYERS. Try again shortly." (never echoes the underlying error, so the token cannot leak). 3 new tests (all failed first). |
| I3 | Important | Only code -16 / HTTP 401 was treated as a token problem | **Fixed, partly unverified** `b118264`. Also maps -22 and the message "could not authenticate". Those come from FYERS community posts, not from a real response here. The reviewer's suggested -8 and -15 were **not** added: I found no source for them. To be confirmed in Task 11. |
| M1 | Minor | UI success path lacked an `aborted` check | **Fixed** (this commit). Also handles a non-JSON reply with "The server returned an unexpected response (HTTP n)." Checked in the browser with a fake 502 HTML reply. |
| M3 | Minor | `DAILY_CHUNK_DAYS = 360` produced 361-day inclusive chunks | **Fixed** (this commit). Test made inclusive; it failed first. |
| M6 | Minor | No test for an as-of date before all candles or on a weekend | **Added** (this commit). Both pass; they document existing behaviour. |
| M2 | Minor | Every control change refetches 3 sequential FYERS calls for identical daily data | **Not fixed.** A short cache keyed by symbol and last session would help; it is a performance improvement, not a correctness issue. Worth doing if rate limits show up in Task 11. |
| M4 | Minor | `candle[0]` / `candle[4]` not type-checked; a malformed row gives an opaque message | **Not fixed.** Safe (turns into a 502); message clarity only. |
| M5 | Minor | The route falls back to the server's `FYERS_ACCESS_TOKEN` env var, like the other routes, so a deployed instance would act as an unauthenticated read-only history proxy | **Not changed.** Consistent with the existing app; matters only if this is ever deployed publicly. Recorded for the cloud-deployment phase. |
| M7 | Minor | Colours are hard-coded hex values and will not adapt to dark mode | **Not fixed.** The legend and `aria-label`s give text equivalents; theming is a polish item. |

## Set aside by the reviewer (ruled on)

- FYERS adjustment status, the `D` resolution code, the chunk limit, the daily epoch-to-IST mapping: disclosed limitations. Still unverified; Task 11 is the place to confirm them.
- No holiday list, so staleness uses a weekday rule: disclosed; the UI says "possibly stale".
- Visual layout, mobile width and real-data rendering: not judged by the reviewer, and not checked by me either.
- The 29 baseline lint errors: out of scope.

## After the fixes (fresh run)

- `npx vitest run`: 156 passed (10 files).
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: 29 errors, all baseline, none in `lib/regime` or `app/markov-regime.tsx`.
