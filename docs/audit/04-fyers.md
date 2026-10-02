# Audit D: FYERS API (token lifetime, history, symbols, limits)

Status: documentation items below are **documented** (read from sources, never run). Nothing is **observed** until the user runs the probe ("Pending user run"). No FYERS credential was used or requested to write this page.

## Source caveat

The official FYERS API v3 docs site (`https://myapi.fyers.in/docsv3`, `/docs/`) returned HTTP 404 to the fetch tool on 2026-10-03, so it could not be read. What was read instead:

| Short name | URL | Nature | Read |
|---|---|---|---|
| FyersDev skills refs | https://github.com/FyersDev/fyers-skills/tree/master/skills/fyers-trading/references (`auth.md`, `symbols.md`, `market-data.md`, `rate-limits.md`) | Repository in FYERS's own GitHub org (`FyersDev`); not the API docs site itself; undated | 2026-10-03 |
| FYERS notice | https://fyers.in/notice-board/new-sebi-framework-for-retail-algo-trading-from-april-01-2026/ | Official FYERS notice | 2026-10-03 |
| FYERS support: new app | https://support.fyers.in/portal/en/kb/articles/how-do-i-activate-the-new-app-for-api-trading-after-april-1-2026 | Official support article | 2026-10-03 |
| FYERS support: data API | https://support.fyers.in/portal/en/kb/fyers-api-integrations/fyers-api/api-v3/data-api | Official support articles (dated 15-11-2023) | 2026-10-03 |
| Community: history limits | https://fyers.in/community/t/limit-in-history/13457 | Community post; reply by apparent FYERS staff, 2024-12-04 | 2026-10-03 |
| Community: refresh token | https://fyers.in/community/t/regenerating-refresh-token-in-fyers-api/13450 | Community thread (users), Nov-Dec 2024 | 2026-10-03 |
| Community: rate limit | https://fyers.in/community/t/rate-limit-v3/13127 | Community thread with FYERS replies, daily cap raised 2024-08-22 | 2026-10-03 |

Treat community items as secondary.

## 1. Token lifetime and refresh (spec section 12 item 1)

| Item | What the sources say | Source | Class |
|---|---|---|---|
| Access token lifetime | Daily: "The access token expires (end of trading day); regenerate it each day." Community thread: "Valid for one day, requires daily regeneration." A search-result summary said "one day (24 hours)"; no source read gives a clock time of expiry. | FyersDev `auth.md`; community 13450 | documented. Exact expiry instant is **unverified** (end of day vs 24 h). |
| Refresh token | 15-day validity. Endpoint `POST https://api-t1.fyers.in/api/v3/validate-refresh-token` with `grant_type=refresh_token`, `appIdHash` (SHA-256 of app id + secret), `refresh_token`, `pin`. Returns a new `access_token` only, no new refresh token. After 15 days a manual browser login is needed. | FyersDev `auth.md`; community 13450 | documented, but see next row |
| Refresh token being withdrawn | FYERS notice for the SEBI retail algo framework effective 2026-04-01: "Users will need to complete 2FA once every trading day. Continuous refresh-token sessions will no longer be supported." FyersDev `auth.md`: "the docs note the refresh-token flow may be discontinued; treat daily re-login as the reliable path." | FYERS notice; FyersDev `auth.md` | documented. Plan for **a manual login every trading day; no unattended refresh.** |
| Auth code | Valid two minutes (2021 community answer) | https://fyers.in/community/api-algo-trading-bihtdkgq/post/fyers-api-errors-common-issues-SKprwXuoU43Ho8B | documented (old, community) |
| Old apps after 2026-04-01 | Existing API apps move to data-only mode: "Only fetching quotes, historical data, order details, positions, and holdings will be allowed"; order placement disabled. New app has App ID ending in "200", requires static IP. | FYERS support: new app | documented. **Check which app type the user's credentials belong to.** Data-only is enough for Phase 0. |

Implication for `FNO_TOKEN_MAX_AGE_HOURS` (current default 8, an assumption): daily 2FA means a token should be treated as dead at the next session or after 24 h at most; 8 h is conservative but within that. Keep it until the user's own timing is observed (below).

### User action for step 3 (observed lifetime)

Please note, in your own words in the "Pending user run" section: (a) the local time you complete the FYERS login that creates the token; (b) the local time the next day when a call first fails with an auth error, and the `code` and HTTP status it returns. Do not paste the token.

## 2. Error codes for expired or invalid tokens

| Code | Meaning | Source | Class |
|---|---|---|---|
| -8, -15, -16, -17 (or HTTP 401) | "token is invalid/expired, re-login, don't retry" | FyersDev `auth.md` and `rate-limits.md` | documented |
| -300 | Invalid symbol (URL-encode specials, verify against symbol master) | FyersDev `rate-limits.md` | documented |
| -50 | Invalid parameters | same | documented |
| -429 / HTTP 429 | Rate limited | same | documented |

The project's current assumption "-16 and -22" is **partly contradicted**: -16 is listed as an auth code, but -22 is not in any source read, and -8, -15 and -17 are missing from that assumption. A community post title also shows `{ s: 'error', code: -17, message: 'Could not authenticate the user' }` (title only, https://community.fyers.in/fyers-api-rha0riqv/post/getting-error-s-error-code--17-message-could-not-authenticate-the-user-Guy3ASwxS0YqIzf; page not read). Observed codes come from the probe or the first real expiry.

## 3. History endpoint (`GET https://api-t1.fyers.in/data/history`)

| Item | Documented value | Source | Class |
|---|---|---|---|
| Parameters | `symbol`, `resolution`, `date_format` (0 = epoch seconds, 1 = yyyy-mm-dd), `range_from`, `range_to`, `cont_flag` (1 for continuous futures), optional `oi_flag=1` | FyersDev `market-data.md` | documented |
| Resolutions | seconds `5S 10S 15S 30S 45S`; minutes `1 2 3 5 10 15 20 30 60 120 240`; day `D` or `1D`; `1W`; `1M` | same | documented. Whether `D` and `1D` both work is checked by the probe. |
| Daily range per request | **366 days** for day/week/month | FyersDev `market-data.md`; community 13457 (FYERS staff reply, 2024-12-04): "up to 366 days per request for 1D" | documented |
| Minute range per request | 100 days; minute history from 2017-07-03 | same | documented |
| Seconds data | last 30 trading days only | same | documented |
| Pagination | chunk the date range and concatenate | same | documented |
| Candle layout | `[epoch, open, high, low, close, volume]`, plus OI when `oi_flag=1` | same | documented |
| Candle timestamp | start of the candle interval | FYERS support: data API | documented |
| Expired option/futures history | **Not documented anywhere read.** FYERS support (data API) says the symbol master "is updated daily" and a missing symbol "likely indicates that the symbol is either invalid or has expired"; invalid symbols return "Please provide a valid symbol". The repo's `EXPIRED_OPTION_HISTORY_UNAVAILABLE` failure mode stands. | FYERS support: data API; FyersDev `symbols.md` ("does not explicitly address expired contracts") | **unverified; depends on the probe** |
| Corporate-action adjustment | Not read (a community thread exists, not fetched) | n/a | unverified |

## 4. Symbol formats

| Instrument | Format | Example | Source | Class |
|---|---|---|---|---|
| Equity | `{Ex}:{Symbol}-{Series}` | `NSE:SBIN-EQ` | FyersDev `symbols.md` | documented |
| Index | `{Ex}:{Name}-INDEX` | `NSE:NIFTY50-INDEX` | same | documented |
| Futures | `{Ex}:{Underlying}{YY}{MMM}FUT` | `NSE:NIFTY20OCTFUT` | same | documented |
| Monthly option | `{Ex}:{Underlying}{YY}{MMM}{Strike}{CE/PE}` | `NSE:NIFTY20OCT11000CE` | same | documented |
| Weekly option | `{Ex}:{Underlying}{YY}{M}{dd}{Strike}{CE/PE}` (1-char month, O/N/D for Oct/Nov/Dec) | `NSE:NIFTY20D1025000CE` | same | documented (index weeklies; not relevant to stock options) |

The FyersDev reference says the symbol master files are "the only reliable way to map a name to an exact symbol" and recommends validating constructed symbols with `/quotes`.

**Relation to NSE bhavcopy names.** The bhavcopy `FinInstrmNm` looks like `SBIN26DEC1040CE` and `TCS26OCTFUT`, which has the same shape as the documented monthly option and futures formats once `NSE:` is prefixed. That similarity is an observation about names, **not** proof that FYERS accepts the symbol, and strike formatting for decimals (e.g. 1040 vs 1040.5) is unchecked.

## 5. Rate limits

| Limit | Value | Source | Class |
|---|---|---|---|
| Per second | 10 requests | FyersDev `rate-limits.md` | documented |
| Per minute | 200 requests | same | documented |
| Per day | 100,000 (raised from 10,000 on 2024-08-22 per community post) | FyersDev; community 13127 | documented |
| Over the limit | HTTP 429; breaching the per-minute limit more than 3 times in a day "results in account blocking for the remainder of that day" | FyersDev `rate-limits.md` | documented |
| Quotes | max 50 symbols per request | FYERS support: data API; FyersDev | documented |
| Orders per second (not needed for paper trading) | 10 | FYERS notice; FyersDev | documented |

Whether history calls count in the same budget is not stated in any source read (unverified).

## Probe: how to run it

`scripts/probe-fyers.mjs` reads `FYERS_CLIENT_ID` and `FYERS_ACCESS_TOKEN` only from the shell environment (never from a file), calls only the FYERS data endpoints `history` and `quotes`, and prints only HTTP status, `s`, `code`, `message`, candle counts and first/last candle times. It never prints headers or the token. It makes 9 history calls plus 25 quotes calls, sequentially (about 34 requests; the 25-call burst is meant to look for a 429 and may trigger one if the calls land faster than 10 per second, which does not cross the per-minute breach rule).

In your own PowerShell, from the repository root, after logging in to FYERS the way you normally do:

```powershell
$env:FYERS_CLIENT_ID = "<your app id>"
$env:FYERS_ACCESS_TOKEN = "<today's access token>"
node scripts/probe-fyers.mjs NSE:<EXPIRED-OPTION-SYMBOL>
Remove-Item Env:FYERS_ACCESS_TOKEN
```

Choosing the expired option symbol: the committed sample `tests/fixtures/real/fo_bhavcopy_sample.zip` is for trade date 2026-10-01 and its earliest expiry is 2026-10-27, so **it contains no expired contract** (checked). Use a name of the same shape from an older bhavcopy, for example a stock option that expired in 2025 or earlier in 2026 (name pattern `<TICKER><YY><MMM><STRIKE><CE|PE>`, then prefix `NSE:`). Whether FYERS accepts that form for expired contracts is exactly what the probe tests. If one name returns code -300, try a second one before concluding.

Futures symbol in the script (`NSE:SBIN26OCTFUT`) expires 2026-10-27; after that change it to a live month.

Paste the printed JSON (no credentials in it) below. Also add the two login/failure times from step 3.

## Pending user run

```
(paste probe JSON here)
```

- Login time (local):
- First auth failure next day (local time, HTTP status, `code`, `message`):

What each probe key answers:

| Key | Question |
|---|---|
| `daily_D_90d`, `daily_1D_90d` | Do `D` and `1D` both work and give the same count |
| `daily_range_360d` to `daily_range_730d` | Where the daily cap bites (documented 366 days: expect 360, 365, 366 ok; 400 and 730 error or truncated) |
| `futures_daily` | Is the live-futures symbol format accepted with `cont_flag=1` |
| `expired_option_daily` | Is expired option history returned, empty, or an error (`code`) |
| `burst_25_quotes_statuses` | Whether 25 rapid quotes calls hit 429 |

Everything in this file stays "documented" until these results are pasted in.
