import { describe, expect, it } from 'vitest';

import { bootstrapDiff, mulberry32 } from '@/lib/ltp-agent/bootstrap';
import { metricsOf, percentileOf } from '@/lib/ltp-agent/metrics';

describe('metricsOf, by hand on [100, -50, 200, -300, 50]', () => {
  const m = metricsOf([100, -50, 200, -300, 50]);
  it('count, win rate, expectancy, net', () => {
    expect(m).toMatchObject({ n: 5, winRate: 0.6, expectancy: 0, netPnl: 0 });
  });
  it('profit factor is gross wins over gross losses: 350 / 350 = 1', () => {
    expect(m.profitFactor).toBe(1);
  });
  it('max drawdown is the biggest fall from a peak of the running P&L: 100, 50, 250, -50, 0 falls 300 from 250', () => {
    expect(m.maxDrawdown).toBe(300);
  });
  it('a peak below zero never counts: the running P&L starts from 0', () => {
    expect(metricsOf([-100, -50]).maxDrawdown).toBe(150);
    expect(metricsOf([50, 50, 50]).maxDrawdown).toBe(0);
  });
  it('no losing trade gives a null profit factor (unbounded); no trades gives zeros', () => {
    expect(metricsOf([10, 20]).profitFactor).toBeNull();
    expect(metricsOf([])).toEqual({ n: 0, winRate: 0, expectancy: 0, profitFactor: 0, maxDrawdown: 0, netPnl: 0 });
  });
});

describe('percentileOf: the share of random runs the candidate beats', () => {
  it('5 against 1..10 beats 4 of 10 = 40', () => {
    expect(percentileOf(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(40);
    expect(percentileOf(100, [1, 2, 3])).toBe(100);
    expect(percentileOf(0, [1, 2, 3])).toBe(0);
    expect(percentileOf(1, [])).toBeNull();
  });
});

describe('bootstrapDiff is seeded and reproducible', () => {
  const a = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 30);
  const b = Array.from({ length: 40 }, (_, i) => -100 + Math.cos(i * 1.3) * 30);
  it('the same seed gives the identical interval, a different seed a different one', () => {
    expect(bootstrapDiff(a, b, 1)).toEqual(bootstrapDiff(a, b, 1));
    expect(bootstrapDiff(a, b, 1)).not.toEqual(bootstrapDiff(a, b, 2));
  });
  it('the mean is the plain difference of means, and a clear gap puts the whole 90% interval above zero', () => {
    const r = bootstrapDiff(a, b, 7);
    expect(r.mean).toBeCloseTo(a.reduce((x, y) => x + y, 0) / 40 - b.reduce((x, y) => x + y, 0) / 40, 9);
    expect(r.lo90).toBeGreaterThan(0);
    expect(r.hi90).toBeGreaterThanOrEqual(r.lo90);
  });
  it('two noisy equal samples give an interval that includes 0', () => {
    const noisy = Array.from({ length: 30 }, (_, i) => (i % 2 ? 80 : -80));
    const r = bootstrapDiff(noisy, [...noisy].reverse(), 3);
    expect(r.lo90).toBeLessThanOrEqual(0);
    expect(r.hi90).toBeGreaterThanOrEqual(0);
  });
  it('an empty sample gives a zero interval instead of NaN', () => {
    expect(bootstrapDiff([], [1, 2], 1)).toEqual({ mean: 0, lo90: 0, hi90: 0 });
  });
  it('the random generator repeats for a seed', () => {
    const x = mulberry32(5); const y = mulberry32(5);
    expect([x(), x(), x()]).toEqual([y(), y(), y()]);
  });
});
