# Audit B: NSE exchange holidays

**Status: UNVERIFIED.** `reference/nse_holidays.json` has `"verified": false`. See "Pending user confirmation".

## Source

- Official NSE JSON feed that backs the holiday page https://www.nseindia.com/resources/exchange-communication-holidays: `https://www.nseindia.com/api/holiday-master?type=trading` (2026 data) and `...&type=trading&year=2025` (2025 data). Read on 2026-10-03 with curl, browser User-Agent and `Referer: https://www.nseindia.com/`. The `FO` key (equity derivatives segment) was used. The HTML page itself was not read (it renders client side); the feed is NSE's own API, but the exact page-to-feed link is inferred, not confirmed.
- Secondary sanity check (web search summaries, not used as a data source): Upstox, Bajaj Finserv and similar sites list the same 16 weekday holidays for 2026 and 14 for 2025 (including 21 Oct 2025).
- Coverage: full calendar years 2025 and 2026, nothing missing from the feed. Feed does not state session times for special sessions.

## Result in the JSON

13 weekday holidays for 2025, 16 for 2026 (29 total). 2025 feed lists 14 weekday holidays; 2025-10-21 was deliberately left out (see Special sessions).

Weekend-only entries (excluded by design): 2025: Republic Day 26 Jan (Sun), Shri Ram Navami 6 Apr (Sun), Bakri Id 7 Jun (Sat), Muharram 6 Jul (Sun). 2026: Mahashivratri 15 Feb (Sun), Id-Ul-Fitr 21 Mar (Sat), Independence Day 15 Aug (Sat), Diwali Laxmi Pujan 8 Nov (Sun, feed marks it with `*`).

## Special sessions (notes only)

- 2025-10-21 (Tue), "Diwali Laxmi Pujan": the feed lists it as a holiday, but the F&O bhavcopy exists (HTTP 200), consistent with the Muhurat trading session being held. Session hours are not in the feed (unverified). It is a trading day for the archive, so it is not in `holidays`. The calendar/engine must treat it as a modified-hours day.
- 2026-11-08 (Sun), Diwali Laxmi Pujan: the `*` in the feed suggests a Muhurat session with timings to be announced; the feed gives no timings (unverified). Weekend, not in `holidays`.
- No special Saturday sessions were found in the feed (not otherwise searched).
- 2026-11-10 (Tue) Balipratipada and later 2026 dates are future holidays and cannot be cross-checked yet.

## Cross-check against archive availability

Method per `01-nse-archives.md`: HEAD on `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_YYYYMMDD_F_0000.csv.zip`, 1 second between requests, retry on 403/429 (none happened).

Window 2026-04-01 to 2026-10-02: 133 weekdays. 7 are listed holidays (2026-04-03, 04-14, 05-01, 05-28, 06-26, 09-14, 10-02): all 404. The other 126 weekdays: all 200. **0 mismatches.** (Note: 2026-03-31 is outside the window.)

Bonus: the 14 weekday holidays in the 2025 feed were also probed: 13 returned 404; 2025-10-21 returned 200 (the Muhurat day above, the only discrepancy, explained).

The check covers only April to October 2026 and 2025 holidays. Holidays before April 2026 in 2026 (15 Jan, 26 Jan, 3 Mar, 26 Mar, 31 Mar) and future ones (20 Oct, 10 Nov, 24 Nov, 25 Dec) were not probed. The archive also does not distinguish a holiday from a day the report was not published.

## Pending user confirmation

Step 4 (human gate) is not done. The user must compare `reference/nse_holidays.json` to the official NSE holiday page, then set `"verified": true` and record who confirmed and when here. Not confirmed by anyone yet.
