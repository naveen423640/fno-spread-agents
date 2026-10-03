# Oracle parity: data layer (cycles and ranked universe)

The Python port (`engine/src/fnoengine/cycles.py`) is compared with the real TypeScript implementation (`discoverCompletedMonthlyCycles`, `rankHistoricalUniverse` in `lib/backtest/nse-data.ts`, unmodified) on identical archives.

## How it runs

- `tests/oracle/dump.oracle.test.ts` is skipped unless `ORACLE_ARCHIVE_DIR`, `ORACLE_OUT`, `ORACLE_TODAY` are set (default `vitest run` stays at 166 passing, 1 skipped). It stubs `fetch` to read `root/fo/YYYYMMDD.zip` (404 when absent) and writes JSON.
- `engine/tests/test_oracle_parity.py` writes an archive into a pytest tmp dir, runs the oracle through `npx vitest run` (subprocess), runs the Python port on the same files, and compares.

## What is compared

Cycles (`expiryDate`, `firstEligibleTradingDay`, `entryTimestamp`, `previousTradingDay`, `t1TradingDay`, exact equality), the order of cycles, and for every cycle the ranked universe: ticker order, rank, lot size, contracts (strike, option type, FYERS symbol; exact), liquidity metric (rel 1e-12). Limits 3 and 50, `today` = 2026-09-30, 6 cycles (Apr-30 .. Sep-24 2026).

## Archives

1. Homogeneous (`write_synthetic_archive`): 8 tickers identical up to a scale factor, one expiry per month, holidays 2026-03-03, 05-01, 06-02, 08-17.
2. Rich (`write_rich_synthetic_archive`, `engine/tests/support/rich_archive.py`), deterministic, with:
   - several STO expiries in even months (extra second-Thursday expiry besides the last-Thursday monthly), so `expiries[-1]` matters;
   - OPTO (options, no futures) and FUTO (futures, no options; never ranked);
   - TIEA and TIEB with exactly identical traded values (ASCII uppercase), ranked 2 and 3 in most cycles, so the ticker tie-break and the limit-3 cut are exercised;
   - month-start holidays (Mar 2-3, May 1, Jun 1-3), the day after an expiry (Jun 26, entry is Jun 29), T-1 holiday (Jul 29), interior holiday (Aug 17); entries on 2026-05-04 and 2026-06-29 are not the first weekday;
   - varied lot sizes, strike grids (including 2.5 steps and 18000+ strikes) and prices; ZLOT has lot size 0 on its first three rows and a strike-0 row (excluded from contracts); liquidity order changes between cycles.

## Result

All four parity runs pass: no differences in cycles, ordering, ranks, lot sizes, contracts or liquidity. No engine bug, oracle bug or deliberate difference was found; nothing in either implementation was changed.

Known acceptable difference (not triggered): TypeScript tie-break uses `localeCompare`, Python uses code-point order. They agree for ASCII uppercase tickers, which is why the tied tickers are ASCII uppercase. Mixed-case or non-ASCII tickers are untested.

## Limit

Synthetic data proves the logic, not real-data behaviour (real NSE column quirks, real holidays, real expiry shifts). Task 18 repeats the comparison on real files.
