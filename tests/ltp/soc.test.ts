import { describe, expect, it } from 'vitest';

import { writerBreakeven } from '@/lib/ltp/extensions';
import { detectSoc, socTarget, type SocResult } from '@/lib/ltp/soc';
import type { LevelShift, SideStrength, StrengthPoint } from '@/lib/ltp/strength';
import type { Status } from '@/lib/ltp/types';
import { makeChain } from '../support/ltp-chain';

const T0 = Date.parse('2026-10-12T10:00:00+05:30') / 1000;
const side = (status: Status, pct: number | null, strike: number): SideStrength => ({
  strike, status, pct: { volume: pct, oi: pct },
  byMetric: { volume: { pct, weak: status !== 'strong', direction: null, toward: null, suppressed: false }, oi: { pct, weak: status !== 'strong', direction: null, toward: null, suppressed: false } },
});
// A strength history sampled every 5 minutes. `sup`/`res` give status and pct at minute m.
const history = (minutes: number, sup: (m: number) => [Status, number], res: (m: number) => [Status, number], strike = (_m: number) => 24000) =>
  Array.from({ length: minutes / 5 + 1 }, (_, i): StrengthPoint => {
    const m = i * 5;
    const [ss, sp] = sup(m); const [rs, rp] = res(m);
    return { ts: T0 + m * 60, levels: null, support: side(ss, sp, strike(m)), resistance: side(rs, rp, 24200) };
  });
const wiggle = (centre: number, half: number) => (m: number) => centre + (Math.floor(m / 5) % 2 === 0 ? -half : half);
const shift = (min: number, side: 'support' | 'resistance' = 'support'): LevelShift => ({ ts: T0 + min * 60, side, metric: 'volume', fromStrike: 24000, toStrike: 23900, cause: 'second-became-highest' });

describe('State of Confusion (C8)', () => {
  it('1-hour: support weak for more than 60 minutes, pct spread within 5 points, no shift: bearish, starts from EOR', () => {
    const h = history(70, () => ['wtb', 0], () => ['strong', 40]).map((p, i) => ({ ...p, support: side('wtb', wiggle(81.5, 1.5)(i * 5), 24000) }));
    const soc = detectSoc(h, [])!;
    expect(soc).toMatchObject({ type: '1h', side: 'support', bias: 'bearish', startedAt: T0, from: 'EOR' });
    expect(soc.targetStrike).toBe(24000);
    expect(soc.spread).toBeCloseTo(3, 5);
  });

  it('is not yet a state of confusion at 50 minutes', () => {
    const h = history(50, () => ['wtb', 80], () => ['strong', 40]);
    expect(detectSoc(h, [])).toBeNull();
  });

  it('2-hour: spread of 12 points for 130 minutes with no shift', () => {
    const h = history(130, () => ['wtb', 0], () => ['strong', 40]).map((p, i) => ({ ...p, support: side('wtb', wiggle(84, 6)(i * 5), 24000) }));
    expect(detectSoc(h, [])).toMatchObject({ type: '2h', side: 'support' });
  });

  it('a spread beyond 15 points is not a state of confusion', () => {
    const h = history(130, () => ['wtb', 0], () => ['strong', 40]).map((p, i) => ({ ...p, support: side('wtb', wiggle(85, 10)(i * 5), 24000) }));
    expect(detectSoc(h, [])).toBeNull();
  });

  it('a shift inside the window rules out the 1-hour and 2-hour types', () => {
    const h = history(130, () => ['wtb', 80], () => ['strong', 40]);
    expect(detectSoc(h, [shift(60)])).toBeNull();
  });

  it('3-hour: the level shifted while weak and has been weak again for more than 180 minutes', () => {
    const h = history(260, (m) => (m === 60 || m === 65 ? ['strong', 40] : ['wtb', 78]), () => ['strong', 40]);
    expect(detectSoc(h, [shift(60)])).toMatchObject({ type: '3h', side: 'support', startedAt: T0 + 70 * 60 });
  });

  it('resistance weak with support Strong is bullish: the rise starts from EOS, target is the highest strike in the zone', () => {
    const h = history(70, () => ['strong', 40], () => ['wtt', 0]).map((p, i) => ({ ...p, resistance: side('wtt', wiggle(82, 1)(i * 5), 24200) }));
    expect(detectSoc(h, [])).toMatchObject({ type: '1h', side: 'resistance', bias: 'bullish', from: 'EOS', targetStrike: 24200 });
  });

  it('there is no state of confusion when the opposite side is also weak', () => {
    const h = history(130, () => ['wtb', 80], () => ['wtt', 80]);
    expect(detectSoc(h, [])).toBeNull();
  });

  it('the clock starts when the side first became weak, not at the start of the day', () => {
    const h = history(130, (m) => (m < 40 ? ['strong', 30] : ['wtb', 80]), () => ['strong', 40]);
    const soc = detectSoc(h, []);
    expect(soc).toMatchObject({ type: '1h', startedAt: T0 + 40 * 60 });
  });

  it('returns null for an empty history or one where the latest snapshot has no strength', () => {
    expect(detectSoc([], [])).toBeNull();
    expect(detectSoc([{ ts: T0, levels: null, support: null, resistance: null }], [])).toBeNull();
  });
});

describe('State of Confusion target (course ch14)', () => {
  const snap = makeChain({ spot: 24037, step: 50, pe: { 23900: { ltp: 40 }, 23850: { ltp: 30 } }, ce: { 24200: { ltp: 55 }, 24250: { ltp: 45 } } });
  const soc = (bias: 'bearish' | 'bullish', targetStrike: number): SocResult => ({ type: '1h', side: bias === 'bearish' ? 'support' : 'resistance', bias, from: bias === 'bearish' ? 'EOR' : 'EOS', startedAt: T0, minutes: 70, spread: 3, targetStrike, zone: { low: targetStrike, high: targetStrike } });

  it('a support SOC (bearish) falls to the diversion of the smallest strike in the zone: the put-side reversal there', () => {
    expect(socTarget(soc('bearish', 23850), snap, writerBreakeven)).toBe(23850 - 30);
  });
  it('a resistance SOC (bullish) rises to the diversion of the largest strike in the zone: the call-side reversal there', () => {
    expect(socTarget(soc('bullish', 24250), snap, writerBreakeven)).toBe(24250 + 45);
  });
  it('is null when the option has no price', () => {
    expect(socTarget(soc('bearish', 23000), snap, writerBreakeven)).toBeNull();
  });
});
