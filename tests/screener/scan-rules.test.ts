import { describe, expect, it } from 'vitest';

import { runBacktest } from '../../lib/screener/backtest';
import { DEFAULT_PARAMS } from '../../lib/screener/config';
import { addIndicators } from '../../lib/screener/indicators';
import { evaluateSide, referenceRules, type Condition, type RuleSet } from '../../lib/screener/rules';
import { runScan } from '../../lib/screener/scan';
import { partsBear, partsBull } from '../../lib/screener/signals';
import { mulberry32 } from '../../lib/screener/synthetic';
import type { Candle, IndRow } from '../../lib/screener/types';
import { candlesOf, loadGolden } from '../support/screener-golden';

const P = DEFAULT_PARAMS;
const golden = loadGolden();
const bench = candlesOf(golden, '^NSEI');
const symbols = Object.keys(golden.data).filter((s) => s !== '^NSEI');
const full: Record<string, Candle[]> = Object.fromEntries(symbols.map((s) => [s, candlesOf(golden, s)]));
const slice = (end: number) => ({ data: Object.fromEntries(symbols.map((s) => [s, full[s].slice(0, end + 1)])) as Record<string, Candle[]>, bench: bench.slice(0, end + 1) });

const preset: RuleSet = { enabled: true, ...referenceRules(P) };
const cond = (left: Condition['left'], op: Condition['op'], value: number, role: Condition['role'] = 'filter'): Condition => ({ left, op, right: { kind: 'value', value }, role });
const vsField = (left: Condition['left'], op: Condition['op'], field: Condition['left'], multiplier = 1, role: Condition['role'] = 'filter'): Condition => ({ left, op, right: { kind: 'field', field, multiplier }, role });

describe('the reference rules written as custom rules give the identical scan', () => {
  for (const scan of golden.scans) {
    it(`as of row ${scan.end}: same candidates, values, strikes and order as the built-in rules`, () => {
      const { data, bench: b } = slice(scan.end);
      const custom = runScan(data, b, P, { expiry: '2026-10-27', rules: preset });
      const builtIn = runScan(data, b, P, { expiry: '2026-10-27' });
      expect(custom).toEqual(builtIn);
      expect(custom.map((r) => [r.symbol, r.side, r.status])).toEqual(scan.fixed_order.map((r) => [r.symbol, r.side, r.status]));
    });
  }
});

// The built-in logic of run_scan for one row, used as the oracle for the preset.
function builtInStatus(row: IndRow, side: 1 | -1): 'SIGNAL' | 'WATCH' | null {
  const [trend, relativeStrength, pullback, trigger, volatilityOk] = (side > 0 ? partsBull : partsBear)(row, P);
  if (!(trend && relativeStrength)) return null;
  return pullback && trigger && volatilityOk ? 'SIGNAL' : pullback && volatilityOk ? 'WATCH' : null;
}
const presetStatus = (row: IndRow, side: 1 | -1) => evaluateSide(row, side > 0 ? preset.bull : preset.bear);

describe('the preset equals the built-in rules row by row (not only on the latest row of each scan)', () => {
  const baseRow = (over: Partial<IndRow>): IndRow => ({ date: '2026-10-01', open: 100, high: 101, low: 99, close: 100, volume: 1000, sma20: 100, sma50: 95, sma200: 90, rsi: 40, rs63: 0.05, volRatio: 1, hv20: 0.3, hvPct: 0.4, prevHigh: 99, prevLow: 101, ...over });

  it('every row of every golden stock, both sides', () => {
    let nonNull = 0;
    let rowsSeen = 0;
    for (const s of symbols) {
      for (const row of addIndicators(full[s], bench)) {
        rowsSeen += 1;
        for (const side of [1, -1] as const) {
          const expected = builtInStatus(row, side);
          if (expected) nonNull += 1;
          expect(presetStatus(row, side)).toBe(expected);
        }
      }
    }
    expect(rowsSeen).toBeGreaterThan(6000);
    expect(nonNull).toBeGreaterThan(20);
  });

  it('100,000 seeded random rows built around the thresholds, both sides, with plenty of real signals and watches', () => {
    const rng = mulberry32(2026);
    const counts = { SIGNAL: 0, WATCH: 0 };
    for (let i = 0; i < 50_000; i += 1) {
      const close = 80 + rng() * 40;
      const row = baseRow({
        close,
        sma20: close * (0.97 + rng() * 0.06),
        sma50: close * (0.9 + rng() * 0.2),
        sma200: close * (0.85 + rng() * 0.3),
        rsi: 25 + rng() * 45,
        rs63: (rng() - 0.5) * 0.2,
        hvPct: rng(),
        prevHigh: close * (0.98 + rng() * 0.04),
        prevLow: close * (0.98 + rng() * 0.04),
      });
      for (const side of [1, -1] as const) {
        const expected = builtInStatus(row, side);
        if (expected) counts[expected] += 1;
        expect(presetStatus(row, side), `row ${i} side ${side}`).toBe(expected);
      }
    }
    expect(counts.SIGNAL).toBeGreaterThan(100);
    expect(counts.WATCH).toBeGreaterThan(100);
  });

  it('rows sitting exactly on every boundary (inclusive and exclusive edges)', () => {
    const rows: IndRow[] = [];
    for (const rsi of [P.rsiBull[0], P.rsiBull[1], P.rsiBear[0], P.rsiBear[1], P.rsiBull[0] - 1e-9, P.rsiBull[1] + 1e-9]) rows.push(baseRow({ rsi }), baseRow({ rsi, close: 80, sma20: 80.5, sma50: 80, sma200: 90, rs63: -0.05, prevLow: 81 }));
    for (const hvPct of [P.hvPctMax, P.hvPctMax + 1e-12, P.hvPctMax - 1e-12]) rows.push(baseRow({ hvPct }), baseRow({ hvPct, close: 80, sma20: 80.5, sma50: 80, sma200: 90, rs63: -0.05, rsi: 58, prevLow: 81 }));
    const b = baseRow({});
    rows.push(baseRow({ close: b.sma20 * P.nearMaUp }), baseRow({ close: b.sma50 * P.nearMaLo, sma50: 100 * 1.0001 }), baseRow({ prevHigh: b.close }), baseRow({ prevHigh: b.close - 1e-9 }), baseRow({ sma50: b.sma200 }), baseRow({ close: b.sma200 }), baseRow({ rs63: 0 }), baseRow({ rs63: 1e-12 }));
    const bear = baseRow({ close: 80, sma20: 80.5, sma50: 80, sma200: 90, rs63: -0.05, rsi: 58, prevLow: 81 });
    rows.push(bear, { ...bear, close: bear.sma20 * (2 - P.nearMaUp) }, { ...bear, close: bear.sma50 * (2 - P.nearMaLo) }, { ...bear, prevLow: bear.close }, { ...bear, prevLow: bear.close + 1e-9 }, { ...bear, sma50: bear.sma200 }, { ...bear, close: bear.sma200 }, { ...bear, rs63: 0 }, { ...bear, rs63: -1e-12 });
    for (const row of rows) for (const side of [1, -1] as const) expect(presetStatus(row, side)).toBe(builtInStatus(row, side));
  });
});

describe('custom rules in the scan', () => {
  const last = 799;
  const { data, bench: b } = slice(last);
  const indicators = Object.fromEntries(symbols.map((s) => [s, addIndicators(data[s], b)]));
  const lastRow = (s: string) => indicators[s][indicators[s].length - 1];

  it('selects exactly the stocks whose latest row passes every filter, on both sides', () => {
    const rules: RuleSet = {
      enabled: true,
      bull: [cond('rsi', '<', 60), vsField('close', '>', 'sma200')],
      bear: [cond('rsi', '>', 40), vsField('close', '<', 'sma200')],
    };
    const rows = runScan(data, b, P, { expiry: '2026-10-27', rules, universe: Object.fromEntries(symbols.map((s, i) => [s, `S${i}`])) });
    const expected = new Set<string>();
    for (const s of symbols) {
      const r = lastRow(s);
      if (r.rsi < 60 && r.close > r.sma200) expected.add(`${s}|BULL CALL`);
      if (r.rsi > 40 && r.close < r.sma200) expected.add(`${s}|BEAR PUT`);
    }
    expect(expected.size).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => `${r.symbol}|${r.side}`))).toEqual(expected);
    expect(rows.every((r) => r.status === 'SIGNAL')).toBe(true);
  });

  it('a failing trigger makes the row a WATCH, a passing one a SIGNAL', () => {
    const rules: RuleSet = { enabled: true, bull: [vsField('close', '>', 'sma200'), vsField('close', '>', 'prevHigh', 1, 'trigger')], bear: [] };
    const rows = runScan(data, b, P, { expiry: '2026-10-27', rules });
    for (const r of rows) {
      const row = lastRow(r.symbol);
      expect(r.status).toBe(row.close > row.prevHigh ? 'SIGNAL' : 'WATCH');
      expect(r.side).toBe('BULL CALL');
    }
    expect(new Set(rows.map((r) => r.status)).size).toBeGreaterThanOrEqual(1);
  });

  it('only scans the side that has rules', () => {
    const bullOnly = runScan(data, b, P, { expiry: '2026-10-27', rules: { enabled: true, bull: [cond('rsi', '>', 0)], bear: [] } });
    expect(bullOnly.length).toBeGreaterThan(0);
    expect(bullOnly.every((r) => r.side === 'BULL CALL')).toBe(true);
    const bearOnly = runScan(data, b, P, { expiry: '2026-10-27', rules: { enabled: true, bull: [], bear: [cond('rsi', '>', 0)] } });
    expect(bearOnly.every((r) => r.side === 'BEAR PUT')).toBe(true);
  });

  it('keeps the reference strike rule and the 2-per-sector cap for custom rules', () => {
    const everyone: RuleSet = { enabled: true, bull: [cond('rsi', '>', 0)], bear: [] };
    const rows = runScan(data, b, P, { expiry: '2026-10-27', rules: everyone, universe: Object.fromEntries(symbols.map((s) => [s, 'SameSector'])) });
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.shortStrikeApprox).toBeGreaterThan(r.longStrikeApprox);
  });

  it('rules that are switched off change nothing, whatever they contain', () => {
    const off: RuleSet = { enabled: false, bull: [cond('rsi', '>', 99)], bear: [cond('rsi', '<', 1)] };
    expect(runScan(data, b, P, { expiry: '2026-10-27', rules: off })).toEqual(runScan(data, b, P, { expiry: '2026-10-27' }));
  });

  it('a rule that can never pass gives no candidates', () => {
    expect(runScan(data, b, P, { expiry: '2026-10-27', rules: { enabled: true, bull: [cond('rsi', '>', 1000)], bear: [] } })).toEqual([]);
  });
});

describe('custom rules in the backtest', () => {
  const stocks = Object.fromEntries(symbols.map((s) => [s, full[s]])) as Record<string, Candle[]>;

  it('the reference rules as custom rules trade exactly like bull_full and bear_full', () => {
    const results = runBacktest(stocks, bench, P, undefined, preset);
    const by = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(results.map((r) => r.name)).toEqual(['bull_full', 'bull_no_trigger', 'oversold_only (RSI<30)', 'oversold_in_uptrend', 'uptrend_baseline', 'bear_full', 'custom_bull', 'custom_bear']);
    expect(by.custom_bull.side).toBe(1);
    expect(by.custom_bear.side).toBe(-1);
    expect(by.bull_full.trades.length).toBeGreaterThan(0);
    const strip = (trades: { sym: string; entry: string; days: number; why: string; R: number }[]) => trades.map((t) => [t.sym, t.entry, t.days, t.why, t.R]);
    expect(strip(by.custom_bull.trades)).toEqual(strip(by.bull_full.trades));
    expect(strip(by.custom_bear.trades)).toEqual(strip(by.bear_full.trades));
    expect(by.custom_bull.stats).toEqual(by.bull_full.stats);
  });

  it('adds a variant only for a side that has rules, and none when the rules are off', () => {
    const bullOnly = runBacktest(stocks, bench, P, undefined, { enabled: true, bull: [cond('rsi', '<', 50)], bear: [] });
    expect(bullOnly.map((r) => r.name).slice(6)).toEqual(['custom_bull']);
    expect(runBacktest(stocks, bench, P, undefined, { enabled: false, bull: [cond('rsi', '<', 50)], bear: [] }).map((r) => r.name)).toHaveLength(6);
    expect(runBacktest(stocks, bench, P).map((r) => r.name)).toHaveLength(6);
  });

  it('reports progress once per variant including the custom ones', () => {
    const seen: [number, number][] = [];
    runBacktest(stocks, bench, P, (done, total) => seen.push([done, total]), preset);
    expect(seen[seen.length - 1]).toEqual([8, 8]);
    expect(seen).toHaveLength(8);
  });
});
