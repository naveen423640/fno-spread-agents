import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../../lib/screener/config';
import { addIndicators } from '../../lib/screener/indicators';
import { partsBear, partsBull, sigBear, sigBull, VARIANTS } from '../../lib/screener/signals';
import type { IndRow } from '../../lib/screener/types';
import { candlesOf, loadGolden } from '../support/screener-golden';

const P = DEFAULT_PARAMS;

describe('signal variants match the Python reference', () => {
  const golden = loadGolden();
  const bench = candlesOf(golden, '^NSEI');
  const symbols = Object.keys(golden.data).filter((s) => s !== '^NSEI');
  const indicators = Object.fromEntries(symbols.map((s) => [s, addIndicators(candlesOf(golden, s), bench)]));

  it('has the six reference variant names and sides', () => {
    expect(Object.fromEntries(Object.entries(VARIANTS).map(([name, v]) => [name, v.side]))).toEqual({
      bull_full: 1, bull_no_trigger: 1, 'oversold_only (RSI<30)': 1, oversold_in_uptrend: 1, uptrend_baseline: 1, bear_full: -1,
    });
  });

  for (const [name, variant] of Object.entries(VARIANTS)) {
    it(`${name}: the same rows fire for every stock`, () => {
      for (const symbol of symbols) {
        const fired = indicators[symbol].flatMap((row, i) => (variant.fn(row, P) ? [i] : []));
        expect(fired, `${name} ${symbol}`).toEqual(golden.masks[name][symbol]);
      }
    });
  }

  it('fires at least once for every variant, so the comparison is not vacuous', () => {
    for (const name of Object.keys(VARIANTS)) {
      expect(symbols.some((s) => golden.masks[name][s].length > 0), name).toBe(true);
    }
  });
});

const row = (over: Partial<IndRow> = {}): IndRow => ({
  date: '2026-10-01', open: 100, high: 101, low: 99, close: 100, volume: 1000,
  sma20: 100, sma50: 95, sma200: 90, rsi: 40, rs63: 0.05, volRatio: 1, hv20: 0.3, hvPct: 0.4, prevHigh: 99, prevLow: 98,
  ...over,
});
const bearRow = (over: Partial<IndRow> = {}): IndRow => row({ close: 80, sma20: 80.5, sma50: 80, sma200: 90, rsi: 58, rs63: -0.05, prevHigh: 82, prevLow: 81, ...over });

describe('bull rules (each part fails on its own)', () => {
  it('a row that meets every rule is a signal', () => {
    expect(partsBull(row(), P)).toEqual([true, true, true, true, true]);
    expect(sigBull(row(), P)).toBe(true);
  });

  it.each([
    ['trend: close at or below the 200-DMA', { close: 89, sma50: 95 }, 0],
    ['trend: 50-DMA not above the 200-DMA', { sma50: 89 }, 0],
    ['relative strength not positive', { rs63: 0 }, 1],
    ['pullback: RSI above the band', { rsi: 49 }, 2],
    ['pullback: RSI below the band', { rsi: 34 }, 2],
    ['pullback: more than 1% above the 20-DMA', { sma20: 98 }, 2],
    ['pullback: more than 3% below the 50-DMA', { sma50: 104, sma200: 90 }, 2],
    ['trigger: close not above the previous high', { prevHigh: 100 }, 3],
    ['volatility percentile above the maximum', { hvPct: 0.61 }, 4],
  ] as const)('%s', (_label, over, index) => {
    const parts = partsBull(row(over), P);
    expect(parts[index]).toBe(false);
    expect(sigBull(row(over), P)).toBe(false);
  });

  it('RSI band edges are inclusive and the percentile maximum is inclusive', () => {
    expect(partsBull(row({ rsi: 35 }), P)[2]).toBe(true);
    expect(partsBull(row({ rsi: 48 }), P)[2]).toBe(true);
    expect(partsBull(row({ hvPct: 0.6 }), P)[4]).toBe(true);
  });

  it('a NaN in any input means no signal', () => {
    for (const key of ['sma200', 'sma50', 'sma20', 'rsi', 'rs63', 'prevHigh', 'hvPct'] as const) {
      expect(sigBull(row({ [key]: Number.NaN }), P), key).toBe(false);
    }
  });

  it('uses the supplied parameters, not constants', () => {
    expect(sigBull(row({ rsi: 52 }), { ...P, rsiBull: [50, 55] })).toBe(true);
    expect(sigBull(row({ hvPct: 0.7 }), { ...P, hvPctMax: 0.8 })).toBe(true);
  });
});

describe('bear rules (mirror)', () => {
  it('a row that meets every rule is a signal', () => {
    expect(partsBear(bearRow(), P)).toEqual([true, true, true, true, true]);
    expect(sigBear(bearRow(), P)).toBe(true);
  });

  it.each([
    ['trend: close at or above the 200-DMA', { close: 91, sma20: 91.5, sma50: 91 }, 0],
    ['trend: 50-DMA not below the 200-DMA', { sma50: 91 }, 0],
    ['relative strength not negative', { rs63: 0 }, 1],
    ['pullback: RSI below the band', { rsi: 51 }, 2],
    ['pullback: RSI above the band', { rsi: 66 }, 2],
    ['pullback: more than 1% below the 20-DMA', { sma20: 82 }, 2],
    ['pullback: more than 3% above the 50-DMA', { sma50: 76 }, 2],
    ['trigger: close not below the previous low', { prevLow: 80 }, 3],
    ['volatility percentile above the maximum', { hvPct: 0.61 }, 4],
  ] as const)('%s', (_label, over, index) => {
    const parts = partsBear(bearRow(over), P);
    expect(parts[index]).toBe(false);
    expect(sigBear(bearRow(over), P)).toBe(false);
  });
});

describe('the other variants', () => {
  it('bull_no_trigger ignores the trigger', () => {
    expect(VARIANTS.bull_no_trigger.fn(row({ prevHigh: 105 }), P)).toBe(true);
    expect(VARIANTS.bull_full.fn(row({ prevHigh: 105 }), P)).toBe(false);
  });

  it('oversold_only fires on RSI below 30 whatever the trend', () => {
    expect(VARIANTS['oversold_only (RSI<30)'].fn(row({ rsi: 29.9, close: 50 }), P)).toBe(true);
    expect(VARIANTS['oversold_only (RSI<30)'].fn(row({ rsi: 30 }), P)).toBe(false);
  });

  it('oversold_in_uptrend needs RSI below 35 and a close above the 200-DMA', () => {
    expect(VARIANTS.oversold_in_uptrend.fn(row({ rsi: 34 }), P)).toBe(true);
    expect(VARIANTS.oversold_in_uptrend.fn(row({ rsi: 34, close: 80 }), P)).toBe(false);
  });

  it('uptrend_baseline needs a close above the 200-DMA and the 50-DMA above the 200-DMA', () => {
    expect(VARIANTS.uptrend_baseline.fn(row(), P)).toBe(true);
    expect(VARIANTS.uptrend_baseline.fn(row({ sma50: 85 }), P)).toBe(false);
  });
});
