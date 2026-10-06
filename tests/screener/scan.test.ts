import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../../lib/screener/config';
import { niceStep } from '../../lib/screener/symbols';
import { orderAndCap, runScan } from '../../lib/screener/scan';
import type { Candle, ScanRow } from '../../lib/screener/types';
import { candlesOf, loadGolden } from '../support/screener-golden';

const P = DEFAULT_PARAMS;
const golden = loadGolden();
const bench = candlesOf(golden, '^NSEI');
const symbols = Object.keys(golden.data).filter((s) => s !== '^NSEI');
const full: Record<string, Candle[]> = Object.fromEntries(symbols.map((s) => [s, candlesOf(golden, s)]));

const slice = (end: number) => ({
  data: Object.fromEntries(symbols.map((s) => [s, full[s].slice(0, end + 1)])) as Record<string, Candle[]>,
  bench: bench.slice(0, end + 1),
});

describe('niceStep matches the reference', () => {
  it.each(golden.nice_step.map((c) => [c.p, c.out] as const))('price %s -> step %s', (price, out) => {
    expect(niceStep(price)).toBe(out);
  });
});

describe('runScan matches the reference (with SIGNAL ordered before WATCH)', () => {
  it('fixture covers both statuses and both sides', () => {
    const rows = golden.scans.flatMap((s) => s.fixed_order);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['SIGNAL', 'WATCH']));
    expect(new Set(rows.map((r) => r.side))).toEqual(new Set(['BULL CALL', 'BEAR PUT']));
  });

  for (const scan of golden.scans) {
    it(`as of row ${scan.end}: same candidates, values and order`, () => {
      const { data, bench: b } = slice(scan.end);
      const rows = runScan(data, b, P, { expiry: '2026-10-27' });
      expect(rows.map((r) => ({
        symbol: r.symbol, sector: r.sector, side: r.side, status: r.status, close: r.close, rsi: r.rsi, rs63_pct: r.rs63Pct,
        vol_x: r.volX, hv_pctile: r.hvPctile, long_strike_approx: r.longStrikeApprox, short_strike_approx: r.shortStrikeApprox,
      }))).toEqual(scan.fixed_order);
    });
  }

  it('the reference order really puts WATCH before SIGNAL somewhere (the bug being fixed), while the port does not', () => {
    const mixed = golden.scans.filter((s) => s.fixed_order.some((r) => r.status === 'SIGNAL') && s.fixed_order.some((r) => r.status === 'WATCH'));
    expect(mixed.length).toBeGreaterThan(0);
    for (const scan of mixed) {
      const { data, bench: b } = slice(scan.end);
      const rows = runScan(data, b, P, { expiry: '2026-10-27' });
      const firstWatch = rows.findIndex((r) => r.status === 'WATCH');
      const lastSignal = rows.map((r) => r.status).lastIndexOf('SIGNAL');
      expect(lastSignal).toBeLessThan(firstWatch);
    }
    expect(mixed.some((s) => s.reference_order[0].status === 'WATCH')).toBe(true);
  });

  it('skips the benchmark and any stock with fewer than 260 sessions', () => {
    const { data, bench: b } = slice(799);
    const short = { ...data, TOOSHORT: data[symbols[0]].slice(0, 200), '^NSEI': b };
    const rows = runScan(short, b, P, { expiry: '2026-10-27' });
    expect(rows.some((r) => r.symbol === 'TOOSHORT' || r.symbol === '^NSEI')).toBe(false);
  });

  it('attaches the expiry and the lot size (null when unknown)', () => {
    const scan = golden.scans.find((s) => s.fixed_order.length > 0)!;
    const { data, bench: b } = slice(scan.end);
    const first = scan.fixed_order[0].symbol;
    const rows = runScan(data, b, P, { expiry: '2026-10-27', lotSizes: { [first]: 125 } });
    expect(rows[0]).toMatchObject({ symbol: first, expiry: '2026-10-27', lotSize: 125 });
    expect(rows.find((r) => r.symbol !== first)?.lotSize ?? null).toBeNull();
  });

  it('top limits the number of rows after ordering and capping', () => {
    const scan = golden.scans.reduce((best, s) => (s.fixed_order.length > best.fixed_order.length ? s : best));
    const { data, bench: b } = slice(scan.end);
    const all = runScan(data, b, P, { expiry: '2026-10-27' });
    const top = runScan(data, b, P, { expiry: '2026-10-27', top: 1 });
    expect(top).toEqual(all.slice(0, 1));
  });
});

const make = (symbol: string, sector: string, side: ScanRow['side'], status: ScanRow['status'], rs: number): ScanRow => ({
  symbol, sector, side, status, close: 100, rsi: 40, rs63Pct: rs, volX: 1, hvPctile: 0.4, longStrikeApprox: 100, shortStrikeApprox: 110, expiry: '2026-10-27', lotSize: null,
});

describe('orderAndCap', () => {
  it('orders SIGNAL first, then by absolute relative strength, descending', () => {
    const rows = orderAndCap([make('A', 'S1', 'BULL CALL', 'WATCH', 9), make('B', 'S2', 'BULL CALL', 'SIGNAL', 1), make('C', 'S3', 'BEAR PUT', 'SIGNAL', -5)]);
    expect(rows.map((r) => r.symbol)).toEqual(['C', 'B', 'A']);
  });

  it('keeps at most 2 per sector per side, taking the best-ranked ones', () => {
    const rows = orderAndCap([
      make('A', 'Banks', 'BULL CALL', 'SIGNAL', 3), make('B', 'Banks', 'BULL CALL', 'SIGNAL', 9), make('C', 'Banks', 'BULL CALL', 'SIGNAL', 6),
      make('D', 'Banks', 'BEAR PUT', 'SIGNAL', -2), make('E', 'IT', 'BULL CALL', 'WATCH', 1),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(['B', 'C', 'D', 'E']);
  });

  it('a WATCH row does not take a sector slot from a SIGNAL row', () => {
    const rows = orderAndCap([make('W1', 'IT', 'BULL CALL', 'WATCH', 9), make('W2', 'IT', 'BULL CALL', 'WATCH', 8), make('S1', 'IT', 'BULL CALL', 'SIGNAL', 1)]);
    expect(rows.map((r) => r.symbol)).toEqual(['S1', 'W1']);
  });

  it('is stable for equal keys', () => {
    const rows = orderAndCap([make('A', 'S1', 'BULL CALL', 'SIGNAL', 5), make('B', 'S2', 'BULL CALL', 'SIGNAL', 5)]);
    expect(rows.map((r) => r.symbol)).toEqual(['A', 'B']);
  });
});
