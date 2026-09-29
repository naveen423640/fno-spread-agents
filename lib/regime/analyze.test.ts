import { describe, expect, it } from 'vitest';

import fixture from '@/tests/fixtures/regime-fixture.json';

import { analyzeRegime } from './analyze';
import type { Candle, LabelWindow, Method } from './types';

const candles: Candle[] = fixture.dates.map((date, i) => ({ date, close: fixture.closes[i] }));
const last = fixture.dates.at(-1)!;

// JSON.stringify would turn NaN into null, so walk the object and check every number directly.
function nonFiniteNumbers(value: unknown, path = 'result'): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path];
  if (Array.isArray(value)) return value.flatMap((item, i) => nonFiniteNumbers(item, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => nonFiniteNumbers(item, `${path}.${key}`));
  return [];
}

describe('analyzeRegime fixture parity (all 8 cases)', () => {
  for (const item of fixture.cases) {
    it(`window ${item.window} / ${item.method}`, () => {
      const result = analyzeRegime({ candles, asOf: last, window: item.window as LabelWindow, method: item.method as Method, horizon: 5 });
      expect(result.labels).toEqual(item.labels);
      expect(result.counts).toEqual(item.counts);
      expect(result.current).toBe(item.current);
      expect(result.insufficientHistory).toBe(false);
      result.matrix!.forEach((row, i) => row.forEach((v, j) => expect(Math.abs(v - item.matrix[i][j])).toBeLessThan(1e-9)));
      result.stationary!.forEach((v, i) => expect(Math.abs(v - item.stationary[i])).toBeLessThan(1e-9));
      expect(Math.abs(result.score!['5']! - (item.score as Record<string, number>)['5'])).toBeLessThan(1e-9);
      const currentIndex = ['Bear', 'Sideways', 'Bull'].indexOf(item.current);
      result.nStepMatrix![currentIndex].forEach((v, j) => expect(Math.abs(v - (item.forecast as Record<string, number[]>)['5'][j])).toBeLessThan(1e-9));
    });
  }
});

describe('no future data', () => {
  it('appending closes after the as-of date changes nothing', () => {
    const asOf = fixture.dates[330];
    const truncated = analyzeRegime({ candles: candles.slice(0, 331), asOf, window: 20, method: 'vol', horizon: 5 });
    const withFuture = analyzeRegime({ candles, asOf, window: 20, method: 'vol', horizon: 5 });
    expect(withFuture).toEqual(truncated);
  });

  it('holds for every method and window, not just one', () => {
    const asOf = fixture.dates[340];
    for (const item of fixture.cases) {
      const args = { asOf, window: item.window as LabelWindow, method: item.method as Method, horizon: 5 as const };
      expect(analyzeRegime({ candles, ...args })).toEqual(analyzeRegime({ candles: candles.slice(0, 341), ...args }));
    }
  });

  it('an as-of date on a non-session day uses the last earlier session', () => {
    const result = analyzeRegime({ candles, asOf: '2099-01-01', window: 20, method: 'fixed', horizon: 1 });
    expect(result.asOf).toBe(last);
  });
});

describe('edge cases', () => {
  it('fewer than 252 defined labels: Not enough history, no matrix, forecast or decision', () => {
    const result = analyzeRegime({ candles: candles.slice(0, 251), asOf: fixture.dates[250], window: 10, method: 'vol', horizon: 5 });
    expect(result.definedLabels).toBeLessThan(252);
    expect(result.insufficientHistory).toBe(true);
    expect(result.matrix).toBeNull();
    expect(result.forecast).toBeNull();
    expect(result.nStepMatrix).toBeNull();
    expect(result.decision).toBeNull();
    expect(result.decisionNote).toBe('Not enough history');
  });

  it('exactly 252 defined labels is enough', () => {
    const result = analyzeRegime({ candles: candles.slice(0, 61 + 252), asOf: fixture.dates[61 + 251], window: 10, method: 'vol', horizon: 5 });
    expect(result.definedLabels).toBe(252);
    expect(result.insufficientHistory).toBe(false);
  });

  it('flat prices: no non-finite number anywhere and no decision', () => {
    const flat: Candle[] = fixture.dates.map((date) => ({ date, close: 100 }));
    const result = analyzeRegime({ candles: flat, asOf: last, window: 20, method: 'vol', horizon: 5 });
    expect(result.insufficientHistory).toBe(true);
    expect(result.decision).toBeNull();
    expect(nonFiniteNumbers(result)).toEqual([]);
  });

  it('no output field is non-finite for a real case either', () => {
    expect(nonFiniteNumbers(analyzeRegime({ candles, asOf: last, window: 40, method: 'vol', horizon: 10 }))).toEqual([]);
  });

  it('empty row for the current state: forecast unavailable with an explanation, decision No trade', () => {
    // Flat-ish series that jumps on the last day: the final state (Bull) has never been left.
    const series: Candle[] = [];
    const start = new Date('2024-01-01T00:00:00Z').getTime();
    for (let i = 0; i < 400; i += 1) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      series.push({ date, close: i < 399 ? 100 + (i % 3) * 0.1 : 200 });
    }
    const result = analyzeRegime({ candles: series, asOf: series.at(-1)!.date, window: 10, method: 'fixed', horizon: 5 });
    expect(result.current).toBe('Bull');
    expect(result.forecast?.['5']).toBeNull();
    expect(result.decision).toBe('No trade');
    expect(result.decisionNote).toMatch(/no transitions observed/i);
    expect(result.emptyRows).toContain(2);
    expect(result.stationary).toBeNull();
  });

  it('unsorted input is sorted; duplicate dates throw', () => {
    const shuffled = [...candles].reverse();
    expect(analyzeRegime({ candles: shuffled, asOf: last, window: 20, method: 'fixed', horizon: 5 }).labels)
      .toEqual(analyzeRegime({ candles, asOf: last, window: 20, method: 'fixed', horizon: 5 }).labels);
    expect(() => analyzeRegime({ candles: [...candles, candles[0]], asOf: last, window: 20, method: 'fixed', horizon: 5 })).toThrow();
  });

  it('reports run length, recent changes, gaps and corporate-action flags', () => {
    const result = analyzeRegime({ candles, asOf: last, window: 10, method: 'vol', horizon: 5 });
    expect(result.runLength).toBeGreaterThanOrEqual(1);
    expect(result.recentChanges.length).toBeLessThanOrEqual(8);
    const jumped = candles.map((c, i) => (i === 300 ? { ...c, close: c.close * 0.2 } : c));
    const flagged = analyzeRegime({ candles: jumped, asOf: last, window: 10, method: 'vol', horizon: 5 });
    expect(flagged.corporateActionFlags.some((f) => f.date === fixture.dates[300])).toBe(true);
  });

  it('computes window move as a simple return over the window', () => {
    const result = analyzeRegime({ candles, asOf: last, window: 10, method: 'vol', horizon: 5 });
    const n = fixture.closes.length - 1;
    expect(result.windowMove).toBeCloseTo(fixture.closes[n] / fixture.closes[n - 10] - 1, 12);
  });
});
