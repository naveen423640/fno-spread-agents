import { describe, expect, it } from 'vitest';

import { runBacktest } from '../../lib/screener/backtest';
import { DEFAULT_PARAMS } from '../../lib/screener/config';
import { addIndicators } from '../../lib/screener/indicators';
import { referenceRules, type Condition, type RuleSet } from '../../lib/screener/rules';
import { runScan } from '../../lib/screener/scan';
import type { Candle } from '../../lib/screener/types';
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
