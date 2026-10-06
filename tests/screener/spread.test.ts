import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../../lib/screener/config';
import { buildActionPlan, spreadCheck, supportResistance, tradingDaysBefore } from '../../lib/screener/spread';
import type { IndRow } from '../../lib/screener/types';

const leg = (bid: number | null, ask: number | null, oi: number | null = 1000) => ({ bid, ask, ltp: bid && ask ? (bid + ask) / 2 : null, oi });

describe('spreadCheck (the live check maths)', () => {
  it('bull call spread: debit is long ask minus short bid, with breakeven and rupees per lot', () => {
    const r = spreadCheck({ side: 1, kLong: 4800, kShort: 5100, long: leg(118, 120), short: leg(40, 40.5), lot: 150 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.debit).toBe(80);
    expect(r.width).toBe(300);
    expect(r.debitPctOfWidth).toBeCloseTo(26.6667, 3);
    expect(r.breakeven).toBe(4880);
    expect(r.maxLossRs).toBe(12_000);
    expect(r.maxProfitRs).toBe(33_000);
    expect(r.rewardToRisk).toBeCloseTo(2.75, 6);
  });

  it('bear put spread: breakeven is the long strike minus the debit', () => {
    const r = spreadCheck({ side: -1, kLong: 4800, kShort: 4500, long: leg(130, 131), short: leg(30, 31), lot: 100 });
    expect(r.ok && r.breakeven).toBe(4800 - 101);
    expect(r.ok && r.width).toBe(300);
  });

  it('notes a debit outside the 30-45% of width guideline, and not inside it', () => {
    const outside = spreadCheck({ side: 1, kLong: 4800, kShort: 5100, long: leg(118, 120), short: leg(40, 40.5), lot: 150 });
    expect(outside.ok && outside.notes.join(' ')).toMatch(/outside the 30-45% of width/);
    const inside = spreadCheck({ side: 1, kLong: 4800, kShort: 5100, long: leg(144, 145), short: leg(40, 40.5), lot: 150 }); // debit 105 = 35%
    expect(inside.ok && inside.notes).toEqual([]);
  });

  it('the 30% and 45% edges are inside the guideline', () => {
    const edge30 = spreadCheck({ side: 1, kLong: 100, kShort: 200, long: leg(39, 40), short: leg(10, 11), lot: 1 }); // debit 30
    const edge45 = spreadCheck({ side: 1, kLong: 100, kShort: 200, long: leg(54, 55), short: leg(10, 11), lot: 1 }); // debit 45
    expect(edge30.ok && edge30.notes).toEqual([]);
    expect(edge45.ok && edge45.notes).toEqual([]);
  });

  it('warns when a leg bid/ask is wider than 2% of its mid, naming the leg', () => {
    const r = spreadCheck({ side: 1, kLong: 4800, kShort: 5100, long: leg(100, 120), short: leg(40, 41), lot: 150 });
    expect(r.ok && r.warnings.some((w) => w.includes('long') && w.includes('wide'))).toBe(true);
    expect(r.ok && r.warnings.some((w) => w.includes('short'))).toBe(true);
    const tight = spreadCheck({ side: 1, kLong: 4800, kShort: 5100, long: leg(119.5, 120), short: leg(40, 40.5), lot: 150 });
    expect(tight.ok && tight.warnings).toEqual([]);
  });

  it('cannot price the spread without a long ask and a short bid', () => {
    expect(spreadCheck({ side: 1, kLong: 4800, kShort: 5100, long: leg(null, null), short: leg(40, 41), lot: 150 })).toMatchObject({ ok: false });
    expect(spreadCheck({ side: 1, kLong: 4800, kShort: 5100, long: leg(118, 120), short: leg(null, 41), lot: 150 })).toMatchObject({ ok: false });
  });

  it('rejects a spread whose strikes do not make sense', () => {
    expect(spreadCheck({ side: 1, kLong: 5100, kShort: 4800, long: leg(118, 120), short: leg(40, 41), lot: 150 })).toMatchObject({ ok: false });
    expect(spreadCheck({ side: -1, kLong: 4500, kShort: 4800, long: leg(118, 120), short: leg(40, 41), lot: 150 })).toMatchObject({ ok: false });
  });

  it('rejects a debit at or above the width (no profit possible) or at or below zero', () => {
    expect(spreadCheck({ side: 1, kLong: 4800, kShort: 5100, long: leg(299, 300), short: leg(0, 1), lot: 150 })).toMatchObject({ ok: false });
    expect(spreadCheck({ side: 1, kLong: 4800, kShort: 5100, long: leg(10, 11), short: leg(50, 51), lot: 150 })).toMatchObject({ ok: false });
  });
});

describe('tradingDaysBefore', () => {
  it('counts back over weekdays only', () => {
    expect(tradingDaysBefore('2026-10-27', 8, new Set())).toBe('2026-10-15');
    expect(tradingDaysBefore('2026-10-27', 1, new Set())).toBe('2026-10-26');
    expect(tradingDaysBefore('2026-10-27', 5, new Set())).toBe('2026-10-20');
  });

  it('skips listed holidays', () => {
    expect(tradingDaysBefore('2026-10-27', 8, new Set(['2026-10-20']))).toBe('2026-10-14');
  });

  it('skips a weekend between the expiry and the target', () => {
    expect(tradingDaysBefore('2026-10-12', 1, new Set())).toBe('2026-10-09');
  });
});

describe('buildActionPlan', () => {
  const base = { side: 1 as const, debit: 100, kLong: 4800, kShort: 5100, lot: 150, expiry: '2026-10-27', params: DEFAULT_PARAMS, lastClose: 4900, sma20: 4950, swing: 4720, holidays: new Set<string>(), today: '2026-10-06' };

  it('profit target is 60% of the way from the debit to the width, premium stop is 50% of the debit', () => {
    const plan = buildActionPlan(base);
    expect(plan.profitTarget.spreadValue).toBeCloseTo(100 + 0.6 * 200, 9); // 220
    expect(plan.profitTarget.profitRsPerLot).toBeCloseTo(0.6 * 200 * 150, 6);
    expect(plan.profitTarget.pctOfMaxProfit).toBe(60);
    expect(plan.premiumStop.spreadValue).toBe(50);
    expect(plan.premiumStop.lossRsPerLot).toBe(50 * 150);
  });

  it('has no rupee amounts when the lot size is unknown (never mislabels per-share figures as per lot)', () => {
    const plan = buildActionPlan({ ...base, lot: null });
    expect(plan.lot).toBeNull();
    expect(plan.profitTarget.profitRsPerLot).toBeNull();
    expect(plan.premiumStop.lossRsPerLot).toBeNull();
    expect(plan.profitTarget.spreadValue).toBeCloseTo(220, 9);
    expect(buildActionPlan(base).lot).toBe(150);
  });

  it('flags a time stop that is already in the past because the expiry is too close for the hold period', () => {
    const late = buildActionPlan({ ...base, expiry: '2026-10-12', today: '2026-10-09' });
    expect(late.timeStop.passed).toBe(true);
    expect(late.timeStop.note).toMatch(/already passed/i);
    const normal = buildActionPlan(base);
    expect(normal.timeStop.passed).toBe(false);
    expect(normal.timeStop.note).not.toMatch(/already passed/i);
  });

  it('time stop is the configured number of trading days before expiry', () => {
    expect(buildActionPlan(base).timeStop.date).toBe('2026-10-15');
    expect(buildActionPlan({ ...base, params: { ...DEFAULT_PARAMS, timeExitLeft: 10 } }).timeStop.date).toBe('2026-10-13');
  });

  it('bull price stop: a close below the 20-DMA or the recent swing low; trail to breakeven at the target', () => {
    const plan = buildActionPlan(base);
    expect(plan.priceStop.direction).toBe('below');
    expect(plan.priceStop.levels).toEqual([{ label: '20-DMA', value: 4950 }, { label: 'Recent swing low', value: 4720 }]);
    expect(plan.trail).toMatch(/breakeven/i);
  });

  it('bear price stop mirrors it: a close above', () => {
    const plan = buildActionPlan({ ...base, side: -1, kLong: 4800, kShort: 4500, swing: 4990 });
    expect(plan.priceStop.direction).toBe('above');
    expect(plan.priceStop.levels[1]).toEqual({ label: 'Recent swing high', value: 4990 });
  });

  it('exit order buys back the short leg first', () => {
    const plan = buildActionPlan(base);
    expect(plan.exitOrder[0]).toMatch(/buy back the short leg first/i);
    expect(plan.exitOrder[1]).toMatch(/sell the long leg/i);
  });

  it('gap-open rules mention the stops and the profit target with their numbers', () => {
    const text = buildActionPlan(base).gapRules.join(' ');
    expect(text).toContain('4720');
    expect(text).toContain('50');
    expect(text).toContain('220');
    expect(text).toMatch(/never average down/i);
  });

  it('prints levels and spread values rounded to two decimals, never raw floating-point noise', () => {
    const text = buildActionPlan({ ...base, debit: 17.4318225865, swing: 89.3612, sma20: 96.397995 + 0.00000000000001 }).gapRules.join(' ');
    expect(text).toContain('89.36');
    expect(text).toContain('96.4');
    expect(text).toContain('8.72');
    expect(text).not.toMatch(/\d\.\d{5,}/);
  });

  it('always carries the manual earnings and news reminder', () => {
    expect(buildActionPlan(base).manualChecks.join(' ')).toMatch(/earnings\/news dates manually/i);
  });
});

const rowsFrom = (closes: number[]): IndRow[] =>
  closes.map((close, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, open: close, high: close + 1, low: close - 1, close, volume: 1000,
    sma20: Number.NaN, sma50: Number.NaN, sma200: Number.NaN, rsi: Number.NaN, rs63: Number.NaN, volRatio: Number.NaN, hv20: Number.NaN, hvPct: Number.NaN, prevHigh: Number.NaN, prevLow: Number.NaN,
  }));

describe('supportResistance (display aid: recent swing pivots)', () => {
  it('finds the nearest pivot highs above and pivot lows below the last close', () => {
    // zig-zag between 90 and 110 with the latest close at 100
    const closes: number[] = [];
    for (let i = 0; i < 60; i += 1) closes.push(i % 10 < 5 ? 90 + (i % 10) * 4 : 110 - ((i % 10) - 5) * 4);
    closes.push(100);
    const { support, resistance } = supportResistance(rowsFrom(closes));
    expect(support.length).toBeGreaterThan(0);
    expect(resistance.length).toBeGreaterThan(0);
    expect(Math.max(...support)).toBeLessThan(100);
    expect(Math.min(...resistance)).toBeGreaterThan(100);
    expect(support).toEqual([...support].sort((a, b) => b - a));
    expect(resistance).toEqual([...resistance].sort((a, b) => a - b));
  });

  it('returns empty lists for a flat or too-short series', () => {
    expect(supportResistance(rowsFrom([100, 100, 100]))).toEqual({ support: [], resistance: [] });
  });
});
