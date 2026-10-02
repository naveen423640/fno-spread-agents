# Audit C: Cost constants (`lib/options-costs.ts`, version `nse-options-2026-09-v1`)

Read on 2026-10-03. NSE circulars were downloaded from `nsearchives.nseindia.com` and read in full. The code was not edited.

Legend: **verified** = official source read and figure matches. **documented-untested** = a source was read but it is a broker or secondary page, or only part of the figure was confirmed. **contradicted** = a source read disagrees with the code.

## Constants

| Constant (code) | Code value | Source found | Figure in source | Status |
|---|---|---|---|---|
| Brokerage per order (`brokeragePerOrder`) | Rs 20 | FYERS pricing page https://fyers.in/pricing (broker, read 2026-10-03; no date on page) | Standard plan: "Rs 20 per executed order" for Options (flat, no cap); Prime plan Rs 15 | verified for the Standard plan. Prime (Rs 4,990/yr) would be Rs 15. |
| Exchange txn charge, options, from 2026-03-01 | 0.000355299 of premium | NSE circular NSE/FA/73061, 2026-02-27, effective 2026-03-01: https://nsearchives.nseindia.com/content/circulars/FA73061.pdf | Rs 3,552.99 per crore premium each side = 0.000355299 | verified |
| IPFT, from 2026-03-01 | 0.000000001 | Same circular | Rs 0.01 per crore premium each side = 1e-9 | verified |
| Exchange txn charge, options, 2024-10-01 to 2026-02-28 | 0.0003503 | NSE circular NSE/FA/64232, 2024-09-27, effective 2024-10-01: https://nsearchives.nseindia.com/content/circulars/FA64232.pdf | Rs 35.03 per lakh premium each side = 0.0003503 | verified |
| IPFT, before 2026-03-01 | 0.000005 | NSE/FA/73061 ("existing" column) and NSE/FA/56129 (2023-03-24, effective 2023-04-01): https://archives.nseindia.com/content/circulars/FA56129.pdf | Rs 50 per crore premium each side = 5e-6 (applies from 2023-04-01; was Rs 0.01 per crore before) | verified for dates on or after 2023-04-01. **Not exact before 2023-04-01** (0.01 per crore = 1e-9). |
| Exchange txn charge, options, before 2024-10-01 | 0.000495 | NSE/FA/56129 (effective 2023-04-01) | Slab-based per member by monthly billable premium turnover. The revised per-lakh rates listed are Rs 50.00, 47.50, 42.50, 37.50 and 30.00 (plus a flat Rs 2,500 for the first Rs 3 cr); the PDF text extraction scrambled which slab maps to which rate. The figure 0.0495% appears in no NSE circular read. | **contradicted/not reproducible** for 2023-04-01 to 2024-09-30: NSE rates were member-slab dependent, 0.0300 to 0.0500 of premium. The code's 0.0495% matches a figure quoted in a web-search summary of a broker page (not read in full), not an NSE circular. Pre-2023-04 slabs not read (unverified). Matters only for backtests dated before 2024-10-01. |
| Clearing (`clearingPercent`) | 0.009 (percent, i.e. 0.00009 of turnover) | FYERS charges list https://fyers.in/charges-list (broker, read 2026-10-03) | "Clearing Charges: 0.009%" for equity options | documented-untested. Only the broker page states it. FYERS support article (below) says clearing charges are "included in the Transaction Charges section" without a rate. No NSE Clearing circular was read for it. |
| SEBI turnover fee | 0.000001 (Rs 10 per crore) | SEBI notification SEBI/L.A.D.-N.R.O./G.N./2019/03 dated 2019-03-22, effective 2019-04-01, read via a CSE-India copy: https://www.cse-india.com/upload/cse_notice/REVISED_SEBI_TURNOVER_FEES.htm ; FYERS charges list | "0.00010 per cent of turnover (Rs 10 per crore)" for stock brokers | verified (copy on a third-party site; FYERS agrees) |
| STT, option sale, from 2026-04-01 | 0.0015 | NSE circular NSE/FATAX/73524, 2026-03-31 (Finance Act 2026, assent 2026-03-30): https://nsearchives.nseindia.com/content/circulars/FATAX73524.pdf | Sale of option: 0.15% (up to 2026-03-31: 0.10%). Exercised option: 0.15% (was 0.125%). Futures sale 0.05% (was 0.02%). | verified. Note: exercise/expiry STT is not modelled in code (square-off only; stated in code comment). |
| STT, option sale, 2024-10-01 to 2026-03-31 | 0.001 | NSE circular NSE/FATAX/63809, 2024-09-09 (Finance Act 2024): https://nsearchives.nseindia.com/content/circulars/FATAX63809.pdf | 0.10% from 2024-10-01 (up to 2024-09-30: 0.0625%) | verified |
| STT, option sale, before 2024-10-01 | 0.000625 | Same circular | 0.0625% up to 2024-09-30 | verified (earlier eras not read) |
| Stamp duty, buy | 0.00003 (0.003%) | FYERS charges list: "0.003% on buy value". Statutory background only via secondary sources (Mondaq/IndiaFilings summaries of Finance Act 2019 and the Indian Stamp (Collection ...) Rules 2019, effective 2020-07-01 per those summaries) | 0.003% options, buy side | documented-untested. No official statute text or NSE Clearing circular was read (the NSE Clearing circular NCL/CMPT/43116 mirror returned HTTP 400). |
| GST | 18% on brokerage + exchange + IPFT + clearing + SEBI | FYERS charges list: "18% on (Brokerage + Exchange Transaction charges + Clearing charges + SEBI Turnover Fee + NSE IPFT)" | matches code exactly | verified against FYERS charges list. **Conflict inside FYERS:** the FYERS support article (https://support.fyers.in/portal/en/kb/articles/what-are-the-statutory-charges-on-trades-at-fyers-stt-gst-sebi-turnover-fee-ipft-etc, page dated 01 Apr 2026) says GST "is not applied to SEBI fees, STT/CTT, or Stamp Duty". The code charges GST on the SEBI fee. Impact: 18% of Rs 10 per crore = Rs 1.8 per crore, negligible. Not an official GST notification; the CBIC source was not read. |

## Findings

1. **No contradiction for dates on or after 2024-10-01** (the range the app uses by default) apart from the GST-on-SEBI-fee wording conflict between two FYERS pages (negligible).
2. **Contradicted / not reproducible:** the pre-2024-10-01 exchange rate `0.000495`. NSE circular NSE/FA/56129 shows slab rates of Rs 30.00 to 50.00 per lakh (0.0300% to 0.0500%) for 2023-04-01 onward, so no single rate is "official". Either treat that era as approximate or restrict cost-aware backtests to dates on or after 2024-10-01.
3. **IPFT before 2023-04-01** is Rs 0.01 per crore per NSE/FA/56129, but the code applies 5e-6. Effect is below Rs 1 on a Rs 1 crore premium turnover. Only relevant to old backtests.
4. **Clearing 0.009% and stamp duty 0.003% are broker-sourced.** Mark documented-untested until an NSE Clearing circular or the contract note of a real FYERS trade confirms them. Suggested user check: compare the model with one actual FYERS option contract note (needs user).
5. **Slippage (`slippagePerUnit` 0.05)** is not a charge; see `05-later-phases.md` section 4.
6. FYERS pages carry no effective dates for the rates themselves (the support article says "01 Apr 2026"; the charges-list page has none). STT and NSE rates above are dated by the circulars.

## Sources read (all 2026-10-03)

- https://nsearchives.nseindia.com/content/circulars/FA73061.pdf (NSE/FA/73061, 2026-02-27)
- https://nsearchives.nseindia.com/content/circulars/FA64232.pdf (NSE/FA/64232, 2024-09-27)
- https://archives.nseindia.com/content/circulars/FA56129.pdf (NSE/FA/56129, 2023-03-24)
- https://nsearchives.nseindia.com/content/circulars/FATAX73524.pdf (NSE/FATAX/73524, 2026-03-31)
- https://nsearchives.nseindia.com/content/circulars/FATAX63809.pdf (NSE/FATAX/63809, 2024-09-09)
- https://fyers.in/pricing and https://fyers.in/charges-list (broker; undated)
- FYERS support article (above), page date 01 Apr 2026
- https://www.cse-india.com/upload/cse_notice/REVISED_SEBI_TURNOVER_FEES.htm (copy of SEBI notification)
- Secondary only (search summaries, not read in full): Mondaq, IndiaFilings and Lexology on the Finance Act 2019 stamp duty rules.
