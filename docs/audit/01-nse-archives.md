# Audit A: NSE archives (evidence for the data layer)

Run on 2026-10-03 (Saturday), from Git Bash on Windows with `curl` (Git's mingw64 build). Raw downloads were kept outside the repo (scratchpad). Only trimmed samples are committed. Every request used the header set below, with about 1 second between requests; no 403/429 was ever returned.

```
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
curl -sI -A "$UA" -e https://www.nseindia.com/ "<URL>"          # HEAD
curl -s  -A "$UA" -e https://www.nseindia.com/ -o OUT -w "%{http_code} %{size_download}\n" "<URL>"   # GET
```

URL patterns (all verified, HTTP 200 on trading days):

- F&O: `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{YYYYMMDD}_F_0000.csv.zip`
- Cash: `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{YYYYMMDD}_F_0000.csv.zip`
- Ban list: `https://nsearchives.nseindia.com/archives/fo/sec_ban/fo_secban_{DDMMYYYY}.csv` (also 200 on `archives.nseindia.com`, same sizes)

A non-trading day returns `HTTP/1.1 404 Not Found` with `Content-Length: 3425` (an HTML error page).

## 1. Dates and publication time (Last-Modified)

Command (per date `d`, for FO and CM):
`curl -sI -A "$UA" -e https://www.nseindia.com/ "https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${d}_F_0000.csv.zip" | grep -iE "^HTTP|last-modified|content-length|^date"`

Trading-day check: 2026-10-02 (Fri) returned 404 for both FO and CM (no report; reason not checked). 2026-10-01, 09-30, 09-29, 09-28 all 200. 2026-09-14 (Mon) returned 404 for FO (only FO probed for that date; reason not checked).

Last-Modified (UTC as returned; IST = UTC+5:30, converted with Python `timedelta`):

| Trade date | FO Last-Modified (UTC) | FO IST | CM Last-Modified (UTC) | CM IST | FO Content-Length | CM Content-Length |
|---|---|---|---|---|---|---|
| 2026-10-01 | Thu, 01 Oct 2026 13:56:02 | 19:26:02 | 11:05:03 | 16:35:03 | 1048928 | 208712 |
| 2026-09-30 | Wed, 30 Sep 2026 13:08:02 | 18:38:02 | 11:03:02 | 16:33:02 | 1066681 | 206815 |
| 2026-09-29 | Tue, 29 Sep 2026 13:47:02 | 19:17:02 | 11:09:02 | 16:39:02 | 1266256 | 206858 |
| 2026-09-28 | Mon, 28 Sep 2026 16:46:01 | 22:16:01 | 11:03:02 | 16:33:02 | 1273609 | 206229 |

Extra FO-only samples (same command, 11 further trading days):

| Trade date | FO IST |
|---|---|
| 2026-09-25 | 18:59:03 |
| 2026-09-24 | 19:08:02 |
| 2026-09-23 | 18:40:32 |
| 2026-09-22 | 18:52:03 |
| 2026-09-21 | 18:44:02 |
| 2026-09-18 | 18:49:02 |
| 2026-09-17 | 18:57:02 |
| 2026-09-16 | 18:41:02 |
| 2026-09-15 | 18:59:02 |
| 2026-09-11 | 18:50:32 |
| 2026-09-10 | 18:43:02 |

Summary over these 15 FO files: min 18:38:02 IST, max 22:16:01 IST, 4 of 15 later than 19:00 IST (09-28, 09-29, 09-24, 10-01). 11 of 15 fall between 18:38 and 19:00 IST. The 22:16 file (2026-09-28) is a single outlier; the other 14 end by 19:26 IST. Older single samples: 2026-04-01 18:56:02, 2026-04-02 19:19:01, 2025-10-01 18:44:02, 2024-10-01 19:50:01 IST.

Caveat (verified): `Last-Modified` is a file mtime, not proof of first availability. Older files show backfill/re-upload times, e.g. CM 2024-10-01 and CM 2024-09-02 report `Last-Modified` of 31 Oct 2024 (08:01:46 and 07:36:18 GMT), and FO/CM for 2024-01-01..05 all report `Fri, 05 Jan 2024 14:xx GMT`. Only recent files (days after publication) were used for the rule. I did not poll the URL before and after publication, so the first-available moment is unverified; only the mtime is.

The cash bhavcopy is much earlier: 16:33 to 16:39 IST on the four days in the first table.

**Recommendation for `BHAVCOPY_PUBLISHED_AFTER`:** 19:00 IST is not supported by the evidence (4 of 15 files were modified later). Set 22:30 IST, later than every observed Last-Modified (max 22:16:01). This is conservative (no look-ahead); a tighter 20:00 IST would cover 14 of 15 observed days but not the 09-28 outlier. Changed in `engine/src/fnoengine/ist.py` and `engine/tests/test_ist.py` (expected UTC 17:00 for 2026-09-29); `engine/.venv/Scripts/python -m pytest engine/tests -q` gives `20 passed`.

## 2. Contents of 2026-10-01 (downloaded to scratchpad, inspected with Python 3.14 `zipfile`/`csv`)

Each zip contains one member: `BhavCopy_NSE_FO_0_0_0_20261001_F_0000.csv` (6,044,690 bytes uncompressed, zip 1,048,928) and `BhavCopy_NSE_CM_0_0_0_20261001_F_0000.csv` (640,497 uncompressed, zip 208,712). No UTF-8 BOM (first 3 bytes checked), LF line endings. FO and CM share the same 34-column header:

```
TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4
```

Note the lot-size column is `NewBrdLotQty`.

Formats observed: `TradDt`, `BizDt`, `XpryDt`, `FininstrmActlXpryDt` are ISO `YYYY-MM-DD` (e.g. `2026-10-01`, `2026-10-27`). Prices are plain decimal strings with 2 places (`435.00`), no thousands separators. `StrkPric` and `OptnTp` are empty for futures. `ISIN` and `SctySrs` are empty for every F&O row (0 non-blank in all four types); they are populated in the cash file (e.g. SBIN: `EQ`, `INE062A01020`).

FO rows: 33,250 total. `FinInstrmTp` values seen: `STO` 26,946, `IDO` 5,651, `STF` 635, `IDF` 18. All four expected types present; no other types. Stock futures: 213 distinct underlyings, expiries `2026-10-27`, `2026-11-23`, `2026-12-29`.

Open interest (futures): `OpnIntrst` and `ChngInOpnIntrst` are populated for futures. Among STF rows with `TtlTradgVol` > 0 (621 rows): `OpnIntrst` non-zero in 621/621, `ChngInOpnIntrst` non-zero in 608/621. IDF with volume: 14/14 both non-zero. STF rows with zero volume still carry OI (e.g. MPHASIS `OpnIntrst=275`, volume 0; PAGEIND 20; PHOENIXLTD 350). Example SBIN Oct future: `OpnIntrst=99194250`, `ChngInOpnIntrst=-338250`. Options also carry OI (STO: 9,750 of 9,764 traded rows non-zero). In the cash file the OI columns are blank. Verdict: futures OI is usable.

Lot size: `NewBrdLotQty` is non-blank on all rows of all four FO types (STF 635/635). In this file SBIN futures `750`, BANKNIFTY futures `30`, ABCAPITAL `3100`. The cash file has `NewBrdLotQty=1`.

Cash file: 3,712 rows, all `FinInstrmTp=STK`; `SctySrs` mix (top 8): EQ 2662, SM 389, BE 246, ST 87, GS 55, GB 44, SG 28, N0 26. SBIN/TCS/RELIANCE are `EQ`: closes 954.10 / 2075.00 / 1167.70, `PrvsClsgPric` 959.50 / 2050.60 / 1187.00.

FO sample row (SBIN Oct future): `2026-10-01,2026-10-01,FO,NSE,STF,48994,,SBIN,,2026-10-27,2026-10-27,,,SBIN26OCTFUT,961.20,969.80,948.90,959.00,958.45,967.20,954.06,959.00,99194250,-338250,9455,6804257550.00,7950,F1,750,,,,,`.

## 3. Format eras

Same URL pattern, same two files per date; header compared programmatically against 2026-10-01.

| Date | FO HTTP | CM HTTP | FO header == today | CM header == today | FO rows by type |
|---|---|---|---|---|---|
| 2026-04-01 (~6 months) | 200, 1314558 B | 200, 185967 B | True | True | STO 39045, STF 631, IDO 5880, IDF 15 (45,571) |
| 2025-10-01 (~12 months) | 200, 1019940 B | 200, 177223 B | True | True | STO 29233, STF 626, IDO 4123, IDF 15 (33,997) |
| 2024-10-01 (~24 months) | 200, 1077296 B | 200, 169301 B | True | True | STO 23457, STF 538, IDO 6792, IDF 15 (30,802) |
| 2024-01-02 (earliest tested) | 200 | 200 | False | False | STO 51354, STF 548, IDO 5140, IDF 12 (57,054) |

2024-01-02 differs only in naming of reserved columns: `Rsvd01..Rsvd04` instead of `Rsvd1..Rsvd4`, and the cash header has one extra empty-named trailing column (35 columns). All other column names and their order match. The change happened somewhere between 2024-01-02 and 2024-10-01 (not bisected). Parsers should key columns by name and ignore `Rsvd*`.

SBIN stock futures carry OI and `NewBrdLotQty=750` in the three older eras too (2024-10-01 OI values 3745500 / 250500 / 101544750).

Earliest date the UDiFF pattern works (monthly probes, then daily), HEAD requests:

- FO 2024-01-01: `HTTP/1.1 200 OK`, `Last-Modified: Fri, 05 Jan 2024 14:45:01 GMT`. CM 2024-01-01: 200, `Fri, 05 Jan 2024 14:39:01 GMT`.
- FO 404 for 2023-12-04, 12-08, 12-11, 12-15, 12-20, 12-21, 12-22, 12-26, 12-27, 12-28, 12-29, 12-30, 12-31, plus 2023-12-01 and 2023-09-01. CM 404 for 2023-12-01 and 2023-09-01. CM for 2023-12-04..12-29 was not probed (unverified), so the CM earliest is bounded by 2023-12-01 (404) and 2024-01-01 (200).
- Monthly probes 2024-02-01, 03-01, 04-01, 05-02, 06-03, 07-01, 08-01, 09-02 all 200 for both FO and CM.

Earliest usable date: 2024-01-01 (verified for FO and CM). Dates before it: unverified for any other archive format or URL (not tried). The files for 2024-01-01..05 carry a backfill mtime (2024-01-05), so they say nothing about the real publication time.

## 4. Ban list

URL (verified): `https://nsearchives.nseindia.com/archives/fo/sec_ban/fo_secban_{DDMMYYYY}.csv`, e.g. `fo_secban_01102026.csv` returns 200, 66 bytes, `Content-Type: text/csv`. Non-trading days return 404 (2026-10-02 holiday and 2026-10-03 Saturday, checked with `curl -w '%{http_code}'`).

Layout (LF line endings, checked with `cat -A`; no header row, the first line is a title):

```
Securities in Ban For Trade Date 29-SEP-2026:
1,LICHSGFIN
2,SAIL
```

Rows are `serial,SYMBOL`. A day with no bans (verified on 2026-07-24, 07-27..07-31, 08-03, 08-04, 08-25, 08-26; 50 bytes) is a single line: `Securities in Ban For Trade Date 26-AUG-2026: NIL` (no rows; "NIL" follows the colon on the same line). Ban files fetched for 2026-07-20..2026-10-01 (all trading days probed) were all 200.

Timing (verified, HEAD `Last-Modified`): the file for trade date T is modified the evening before T. 2026-10-01: Wed, 30 Sep 2026 12:25:05 GMT (17:55 IST). 2026-09-30: Tue, 29 Sep 13:19:03 (18:49 IST). 2026-09-29: Mon, 28 Sep 14:01:03 (19:31 IST). 2026-09-28 (Mon): Fri, 25 Sep 12:33:04 (18:03 IST). 2026-09-25: Thu, 24 Sep 12:47:04 (18:17 IST). 2026-09-24: Wed, 23 Sep 12:37:03 (18:07 IST). So the list "for trade date T" is published the prior trading day evening; it is forward-looking, not an end-of-day-T artifact. Do not apply the bhavcopy `available_after` rule to it (observed up to 19:31 IST on the prior trading day). The meaning ("in ban for trading on T") is taken from the file title only; not checked against exchange circulars.

Committed fixtures: `fo_secban_sample.csv` (2026-09-29, two banned names) and `fo_secban_nil_sample.csv` (2026-08-26, NIL day; an addition beyond the brief).

## 5. Trimmed samples (committed)

`python scripts/trim_bhavcopy.py <in.zip> <out.zip> SBIN TCS RELIANCE` on the 2026-10-01 files:

- FO: `kept 556 rows for ['RELIANCE', 'SBIN', 'TCS']` -> `tests/fixtures/real/fo_bhavcopy_sample.zip`, 21,082 bytes. Content: STO RELIANCE 200, TCS 190, SBIN 157; STF 3 each. No index (IDF/IDO) rows in this sample.
- CM: `kept 3 rows` -> `tests/fixtures/real/cm_bhavcopy_sample.zip`, 653 bytes (one STK/EQ row per ticker).
- `fo_secban_sample.csv` 65 bytes, `fo_secban_nil_sample.csv` 50 bytes.

## 6. Constants and classification

| Item | Result | Status |
|---|---|---|
| (a) `BHAVCOPY_PUBLISHED_AFTER` | 19:00 IST contradicted (4/15 FO files modified later, max 22:16:01). Use 22:30 IST. Cash file about 16:33-16:39 IST. | verified (mtime evidence); first-availability moment unverified |
| (b) Futures OI | `OpnIntrst`/`ChngInOpnIntrst` populated on STF/IDF; usable | verified |
| (c) Ban list | URL and layout above; NIL form observed; published prior evening for trade date T | verified |
| (d) Earliest usable date | 2024-01-01 (same URL; header differs only in `Rsvd0x` naming and one extra empty CM column before some date after 2024-01-02) | verified from 2024-01-01 on; earlier unverified |
| Lot size column | `NewBrdLotQty` present on all FO rows | verified |
| Dates/encoding | ISO `YYYY-MM-DD`, no BOM, LF | verified |
| Instrument types | `STO`, `STF`, `IDO`, `IDF` in FO; `STK` in CM; no others | verified (2026-10-01 and three older dates) |

Unverified: the exact moment each file first became downloadable (no pre/post-publication polling); causes of the 404s on 2026-09-14 and 2026-10-02; CM availability for 2023-12-04..29; pre-2024 formats and URLs; whether ban files are revised intraday; whether recent files are ever re-published after the fact (only older files showed re-upload mtimes).
