import { describe, expect, it } from 'vitest';

import { addIndicators } from '../../lib/screener/indicators';
import type { Candle } from '../../lib/screener/types';
import { candlesOf, closeTo, loadGolden } from '../support/screener-golden';

const FIELDS = [['sma20', 'sma20'], ['sma50', 'sma50'], ['sma200', 'sma200'], ['rsi', 'rsi'], ['rs63', 'rs63'], ['vol_ratio', 'volRatio'], ['hv20', 'hv20'], ['hv_pct', 'hvPct'], ['prev_high', 'prevHigh'], ['prev_low', 'prevLow']] as const;

describe('addIndicators matches the Python reference', () => {
  const golden = loadGolden();
  const bench = candlesOf(golden, '^NSEI');

  for (const symbol of Object.keys(golden.indicators)) {
    it(`${symbol}: every indicator at the sampled indices, including warm-up NaNs`, () => {
      const rows = addIndicators(candlesOf(golden, symbol), bench);
      expect(rows).toHaveLength(golden.data[symbol].c.length);
      for (const [pyName, tsName] of FIELDS) {
        const expected = golden.indicators[symbol][pyName];
        golden.indicator_index.forEach((rowIndex, k) => {
          const actual = rows[rowIndex][tsName];
          expect(closeTo(actual, expected[k]), `${symbol} ${pyName}[${rowIndex}] ts=${actual} py=${expected[k]}`).toBe(true);
        });
      }
    });
  }

  it('keeps the date and the raw OHLCV on each row', () => {
    const candles = candlesOf(golden, Object.keys(golden.indicators)[0]);
    const rows = addIndicators(candles, bench);
    expect(rows[5]).toMatchObject({ date: candles[5].date, open: candles[5].open, high: candles[5].high, low: candles[5].low, close: candles[5].close, volume: candles[5].volume });
  });
});

const series = (closes: number[], start = '2024-01-01'): Candle[] => {
  const base = new Date(`${start}T00:00:00Z`).getTime();
  return closes.map((close, i) => ({ date: new Date(base + i * 86_400_000).toISOString().slice(0, 10), open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 }));
};

describe('hand-checked indicator cases', () => {
  it('SMA of 1..30: sma20 is NaN for the first 19 rows and 10.5 at index 19', () => {
    const closes = Array.from({ length: 30 }, (_, i) => i + 1);
    const rows = addIndicators(series(closes), series(closes));
    expect(Number.isNaN(rows[18].sma20)).toBe(true);
    expect(rows[19].sma20).toBeCloseTo(10.5, 12);
    expect(rows[29].sma20).toBeCloseTo(20.5, 12);
  });

  it('RSI of a strictly rising series is 100 and of a strictly falling series is 0', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    const down = Array.from({ length: 40 }, (_, i) => 200 - i);
    expect(addIndicators(series(up), series(up))[39].rsi).toBe(100);
    expect(addIndicators(series(down), series(down))[39].rsi).toBeCloseTo(0, 12);
  });

  it('RSI uses Wilder smoothing seeded by the first change (hand-computed for 100, 102, 101, 103)', () => {
    const rows = addIndicators(series([100, 102, 101, 103]), series([100, 102, 101, 103]));
    const a = 1 / 14;
    // changes +2, -1, +2. ru: 2, then (1-a)*2, then (1-a)*ru2 + 2a. rd: 0, then a*1, then (1-a)*rd2.
    const ru2 = (1 - a) * 2;
    const rd2 = a * 1;
    const ru3 = (1 - a) * ru2 + a * 2;
    const rd3 = (1 - a) * rd2;
    expect(rows[1].rsi).toBe(100);
    expect(rows[3].rsi).toBeCloseTo(100 - 100 / (1 + ru3 / rd3), 10);
  });

  it('rs63 is the 63-session return minus the benchmark return on the same date', () => {
    const stock = Array.from({ length: 70 }, (_, i) => 100 * 1.001 ** i);
    const bench = Array.from({ length: 70 }, (_, i) => 100 * 1.0004 ** i);
    const rows = addIndicators(series(stock), series(bench));
    expect(Number.isNaN(rows[62].rs63)).toBe(true);
    expect(rows[63].rs63).toBeCloseTo(1.001 ** 63 - 1.0004 ** 63, 12);
  });

  it('rs63 is NaN on a date the benchmark does not have', () => {
    const stock = series(Array.from({ length: 70 }, (_, i) => 100 + i));
    const bench = series(Array.from({ length: 70 }, (_, i) => 100 + i)).filter((_, i) => i !== 65);
    const rows = addIndicators(stock, bench);
    expect(Number.isNaN(rows[65].rs63)).toBe(true);
  });

  it('volRatio is volume over its 20-session mean, and prevHigh and prevLow are shifted by one', () => {
    const candles = series(Array.from({ length: 25 }, () => 50));
    candles[24].volume = 2000;
    const rows = addIndicators(candles, candles);
    expect(rows[24].volRatio).toBeCloseTo(2000 / ((19 * 1000 + 2000) / 20), 12);
    expect(Number.isNaN(rows[0].prevHigh)).toBe(true);
    expect(rows[3].prevHigh).toBe(candles[2].high);
    expect(rows[3].prevLow).toBe(candles[2].low);
  });
});
