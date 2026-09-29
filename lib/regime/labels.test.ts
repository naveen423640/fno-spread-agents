import { describe, expect, it } from 'vitest';

import fixture from '@/tests/fixtures/regime-fixture.json';

import { labelSeries } from './labels';
import type { LabelWindow, Method } from './types';

describe('labelSeries against the fixture', () => {
  for (const item of fixture.cases) {
    it(`labels exactly for window ${item.window} / ${item.method}`, () => {
      const { labels } = labelSeries(fixture.closes, item.window as LabelWindow, item.method as Method);
      expect(labels).toEqual(item.labels);
    });
  }
});

describe('labelSeries rules', () => {
  const rising = Array.from({ length: 120 }, (_, i) => 100 * 1.001 ** i);

  it('fixed: undefined before t = window, and never Sideways by default in warm-up', () => {
    const { labels } = labelSeries(rising, 10, 'fixed');
    expect(labels.slice(0, 10).every((l) => l === null)).toBe(true);
    expect(labels[10]).not.toBeNull();
  });

  it('vol: undefined before t = 61 even when the window is small', () => {
    const { labels } = labelSeries(rising, 10, 'vol');
    expect(labels.slice(0, 61).every((l) => l === null)).toBe(true);
  });

  it('vol: excludes day t from sigma (a jump on day t does not shrink its own z)', () => {
    const base = Array.from({ length: 80 }, (_, i) => 100 + (i % 2 === 0 ? 0.5 : -0.5));
    const jump = [...base, 130];
    const { metric } = labelSeries(jump, 10, 'vol');
    const t = jump.length - 1;
    const returns = base.slice(1).map((c, i) => Math.log(c / base[i]));
    const window60 = returns.slice(returns.length - 60);
    const mean = window60.reduce((a, b) => a + b, 0) / 60;
    const sigma = Math.sqrt(window60.reduce((s, v) => s + (v - mean) ** 2, 0) / 59);
    expect(metric[t]).toBeCloseTo(Math.log(130 / jump[t - 10]) / (sigma * Math.sqrt(10)), 10);
  });

  it('labels either side of the fixed ±5% thresholds', () => {
    // An input of exactly +5% is not reliable in floating point (105 / 100 - 1 is 0.05000000000000004),
    // so the boundary is tested on both sides instead.
    const label = (last: number) => labelSeries([...Array(10).fill(100), last], 10, 'fixed').labels[10];
    expect(label(105.01)).toBe('Bull');
    expect(label(104.99)).toBe('Sideways');
    expect(label(95.01)).toBe('Sideways');
    expect(label(94.99)).toBe('Bear');
  });

  it('flat prices: vol labels stay undefined and no metric is NaN or Infinity', () => {
    const flat = Array(200).fill(100);
    const vol = labelSeries(flat, 20, 'vol');
    expect(vol.labels.every((l) => l === null)).toBe(true);
    expect(vol.metric.every((m) => m === null)).toBe(true);
    const fixed = labelSeries(flat, 20, 'fixed');
    expect(fixed.metric.filter((m) => m !== null).every((m) => Number.isFinite(m as number))).toBe(true);
  });
});
