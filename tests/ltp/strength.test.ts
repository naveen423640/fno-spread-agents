import { describe, expect, it } from 'vitest';

import { computeLevels } from '@/lib/ltp/levels';
import { pctOf, statusOf, trackStrength } from '@/lib/ltp/strength';
import { makeChain } from '../support/ltp-chain';

// Spot 24437 makes the imaginary line 24400 / 24450, so support searches 24450 and below (the upper strike of the pair), resistance 24400 and above.
const SPOT = 24437;
type Cells = Record<number, { volume?: number; oi?: number }>;
const chain = (pe: Cells = {}, ce: Cells = {}, ts = 0) => makeChain({ spot: SPOT, step: 50, ts, pe, ce });
const status = (side: 'support' | 'resistance', s: ReturnType<typeof chain>) => { const l = computeLevels(s)!; return statusOf(side, l[side], l.line); };

describe('pct and the 75% boundary (C3)', () => {
  it('pct is second-highest over highest, as a percent', () => {
    expect(pctOf({ strike: 1, value: 200, secondStrike: 2, secondValue: 150 })).toBe(75);
    expect(pctOf({ strike: 1, value: 200, secondStrike: null, secondValue: null })).toBeNull();
    expect(pctOf({ strike: 1, value: 0, secondStrike: 2, secondValue: 0 })).toBeNull(); // no division by zero
    expect(pctOf(null)).toBeNull();
  });

  it('exactly 75.00 is Strong; 75.01 is Weak', () => {
    const at = (second: number) => chain({ 24400: { volume: 100000, oi: 100000 }, 24300: { volume: second, oi: second } });
    expect(status('support', at(75000)).status).toBe('strong');
    expect(status('support', at(75010)).status).toBe('wtb'); // second-highest below the level
  });

  it('the second-highest above the level is WTT, below it WTB (support and resistance)', () => {
    const supAbove = chain({ 24300: { volume: 100000, oi: 100000 }, 24400: { volume: 90000, oi: 90000 } });
    expect(status('support', supAbove).status).toBe('wtt');
    const resBelow = chain({}, { 24500: { volume: 100000, oi: 100000 }, 24450: { volume: 90000, oi: 90000 } });
    expect(status('resistance', resBelow).status).toBe('wtb');
    const resAbove = chain({}, { 24500: { volume: 100000, oi: 100000 }, 24600: { volume: 90000, oi: 90000 } });
    expect(status('resistance', resAbove).status).toBe('wtt');
  });

  it('a highest value of zero gives no pct and a Strong level, not an error', () => {
    const zeros = Object.fromEntries(Array.from({ length: 22 }, (_, i) => 23900 + i * 50).map((k) => [k, { volume: 0, oi: 0 }]));
    const s = status('support', chain(zeros));
    expect(s.status).toBe('strong');
    expect(s.byMetric.volume.pct).toBeNull();
  });
});

describe('combining volume and OI', () => {
  it('only one metric weak and its second-highest moves away from the line: still Strong', () => {
    // Support level 24300; volume has its second at 24200 (below, away from the line) at 90%; OI is comfortably Strong.
    const s = chain({ 24300: { volume: 100000, oi: 100000 }, 24200: { volume: 90000, oi: 40000 } });
    const r = status('support', s);
    expect(r.byMetric.volume).toMatchObject({ weak: true, direction: 'wtb', toward: false });
    expect(r.byMetric.oi.weak).toBe(false);
    expect(r.status).toBe('strong');
  });

  it('either metric weak with its second-highest moving toward the line: Weak (support WTT, resistance WTB)', () => {
    const sup = chain({ 24300: { volume: 100000, oi: 100000 }, 24400: { volume: 90000, oi: 40000 } });
    expect(status('support', sup).status).toBe('wtt');
    const res = chain({}, { 24500: { volume: 100000, oi: 100000 }, 24450: { volume: 40000, oi: 90000 } });
    expect(status('resistance', res).status).toBe('wtb');
  });

  it('both metrics weak in the same direction keep that direction', () => {
    const s = chain({ 24400: { volume: 100000, oi: 100000 }, 24300: { volume: 90000, oi: 80000 } });
    expect(status('support', s).status).toBe('wtb');
  });

  it('WTT on one metric and WTB on the other: the metric whose level is closer to the line wins', () => {
    // Volume level 24300 (100 below the line) with its second at 24400 (above: WTT). OI level 24100 (300 below) with its second at 24000 (WTB).
    const volumeCloser = chain({ 24300: { volume: 100000, oi: 1000 }, 24400: { volume: 90000, oi: 1000 }, 24100: { volume: 1000, oi: 100000 }, 24000: { volume: 1000, oi: 90000 } });
    expect(status('support', volumeCloser).status).toBe('wtt');
    // Swap which metric sits closer to the line.
    const oiCloser = chain({ 24300: { volume: 1000, oi: 100000 }, 24400: { volume: 1000, oi: 90000 }, 24100: { volume: 100000, oi: 1000 }, 24000: { volume: 90000, oi: 1000 } });
    expect(status('support', oiCloser).status).toBe('wtt');
    const awayCloser = chain({ 24300: { volume: 100000, oi: 1000 }, 24200: { volume: 90000, oi: 1000 }, 24100: { volume: 1000, oi: 100000 }, 24400: { volume: 1000, oi: 90000 } });
    // Volume level 24300 is closer and its second (24200) is below: WTB wins over the farther OI metric's WTT-side signal.
    expect(status('support', awayCloser).status).toBe('wtb');
  });
});

describe('a level based on one metric only (course ch09)', () => {
  // Volume peaks at 24300 (closer to the line, so it sets the level); OI peaks farther out at 24100. Support searches 24450 and below.
  it('the deciding metric alone decides, in either direction: its box away from the line still makes the level weak', () => {
    const s = chain({ 24300: { volume: 100000, oi: 1000 }, 24200: { volume: 90000, oi: 1000 }, 24100: { volume: 1000, oi: 100000 } });
    const r = status('support', s);
    expect(r.byMetric.volume).toMatchObject({ weak: true, direction: 'wtb', toward: false });
    expect(r.status).toBe('wtb'); // a level based on both metrics would stay Strong here
  });

  it('the other metric counts only when its box crosses the level on the line side: support turns WTT', () => {
    // OI's second-highest is at 24400, between the line and the level 24300.
    const s = chain({ 24300: { volume: 100000, oi: 1000 }, 24100: { volume: 1000, oi: 100000 }, 24400: { volume: 1000, oi: 90000 } });
    expect(status('support', s).status).toBe('wtt');
  });

  it('the other metric does not count when its box stays beyond the level, even though it is weak', () => {
    const s = chain({ 24300: { volume: 100000, oi: 1000 }, 24100: { volume: 1000, oi: 100000 }, 24000: { volume: 1000, oi: 90000 } });
    const r = status('support', s);
    expect(r.byMetric.oi.weak).toBe(true);
    expect(r.status).toBe('strong');
  });

  it('a toward-the-line box of the other metric that stops short of the level does not count either', () => {
    // OI level 24100 with second 24200: toward the line for OI, but still below the support level 24300.
    const s = chain({ 24300: { volume: 100000, oi: 1000 }, 24100: { volume: 1000, oi: 100000 }, 24200: { volume: 1000, oi: 90000 } });
    expect(status('support', s).status).toBe('strong');
  });

  it('resistance mirrors it: the other metric crossing below the level makes it WTB', () => {
    const crossing = chain({}, { 24500: { volume: 100000, oi: 1000 }, 24700: { volume: 1000, oi: 100000 }, 24450: { volume: 1000, oi: 90000 } });
    expect(status('resistance', crossing).status).toBe('wtb');
    const awayBox = chain({}, { 24500: { volume: 100000, oi: 1000 }, 24600: { volume: 90000, oi: 1000 }, 24700: { volume: 1000, oi: 100000 } });
    expect(status('resistance', awayBox).status).toBe('wtt'); // the deciding metric's own box, away from the line
  });
});

describe('shifts (C3)', () => {
  const sup = (second: number, top = 100000, ts = 0) => chain({ 24400: { volume: top, oi: top }, 24300: { volume: second, oi: second } }, {}, ts);

  it('support shifts from 24400 to 24300 when 24300 rises from 92.93% above 24400, and a LevelShift is emitted per metric', () => {
    const { perSnapshot, events } = trackStrength([sup(92930, 100000, 60), sup(99000, 100000, 120), sup(101000, 100000, 180)]);
    expect(perSnapshot[0].support!.status).toBe('wtb');
    expect(perSnapshot[0].support!.pct.volume).toBeCloseTo(92.93, 2);
    expect(perSnapshot[2].levels!.support.strike).toBe(24300);
    const volumeShifts = events.filter((e) => e.metric === 'volume');
    expect(volumeShifts).toEqual([{ ts: 180, side: 'support', metric: 'volume', fromStrike: 24400, toStrike: 24300, cause: 'second-became-highest' }]);
    expect(events.filter((e) => e.metric === 'oi')).toHaveLength(1);
  });

  it('24300 falling to 80% then 74% of 24400: Strong at 24400, no shift', () => {
    const { perSnapshot, events } = trackStrength([sup(92930, 100000, 60), sup(80000, 100000, 120), sup(74000, 100000, 180)]);
    expect(events).toEqual([]);
    expect(perSnapshot[1].support!.status).toBe('wtb');
    expect(perSnapshot[2].support!.status).toBe('strong');
    expect(perSnapshot[2].levels!.support.strike).toBe(24400);
  });

  it('after a shift the old strike is NOT ignored: the tool shows the weakness at it straight away (real SENSEX resistance, 11:17: shifted to 72500 and printed WTT-73000)', () => {
    const old = (v: number, ts: number) => chain({ 24300: { volume: 100000, oi: 100000 }, 24400: { volume: v, oi: v } }, {}, ts);
    const series = [sup(99000, 100000, 60), sup(101000, 100000, 120), old(99000, 180), old(60000, 240), old(90000, 300)];
    const { perSnapshot } = trackStrength(series);
    expect(perSnapshot[1].levels!.support.strike).toBe(24300); // shifted at 120
    expect(perSnapshot[1].support!.status).toBe('wtt'); // the old strike (24400, at 99%) is weak towards top at once
    expect(perSnapshot[3].support!.status).toBe('strong'); // 24400 fell to 60%
    expect(perSnapshot[4].support!.status).toBe('wtt'); // and came back at 90%
  });

  it('keeps a pct series per side and metric for the chart, and skips snapshots that have no line', () => {
    const noLine = makeChain({ spot: 10, step: 50, strikes: [24000, 24050], ts: 30 });
    const { perSnapshot } = trackStrength([noLine, sup(92930, 100000, 60)]);
    expect(perSnapshot[0].levels).toBeNull();
    expect(perSnapshot[0].support).toBeNull();
    expect(perSnapshot[1].support!.pct.oi).toBeCloseTo(92.93, 2);
    expect(perSnapshot.map((p) => p.ts)).toEqual([30, 60]);
  });
});
