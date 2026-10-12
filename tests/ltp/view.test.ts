import { describe, expect, it } from 'vitest';

import { analyzeSession } from '@/lib/ltp/analyze';
import { istTs } from '@/lib/ltp/time';
import { columnPercents, conditionSummary, highlightCells, healthBadge, logLabel, logTime, phaseAge, popupTitle, scenarioHeadline, tradeLevels, windowLabel } from '@/lib/ltp/view';
import { makeChain } from '../support/ltp-chain';
import type { ChainView } from '@/lib/ltp/state';

const cell = (volume: number, oi = volume) => ({ ltp: 10, oi, oiChange: 0, volume });
const row = (strike: number, ce: number, pe: number): ChainView => ({ strike, ce: cell(ce), pe: cell(pe), mark: null, role: null, callReversal: null, putReversal: null });
// The line sits between 24000 and 24050. Puts count at 24000 and below, calls at 24050 and above.
const LINE = { low: 24000, high: 24050 };

describe('highlightCells', () => {
  const chain = [row(23900, 1, 1000), row(23950, 1, 800), row(24000, 1, 500), row(24050, 900, 1), row(24100, 700, 1), row(24150, 400, 1)];

  it('marks the highest value of each side and metric among the strikes the engine searches, and nothing outside them', () => {
    const marks = highlightCells(chain, LINE, 75);
    expect(marks['23900|PE|volume']).toBe('max');
    expect(marks['23900|PE|oi']).toBe('max');
    expect(marks['24050|CE|volume']).toBe('max');
    expect(marks['24050|CE|oi']).toBe('max');
    expect(marks['24050|PE|volume']).toBeUndefined(); // a put above the line is in the column but neither the highest nor a yellow box
    expect(marks['24000|CE|volume']).toBeUndefined(); // calls below the line are not searched
  });

  it('marks the second-highest only when it is above the threshold of the highest: 800 of 1000 is, 700 of 900 (77.8%) is, 400 of 900 is not', () => {
    const marks = highlightCells(chain, LINE, 75);
    expect(marks['23950|PE|volume']).toBe('second_weak');
    expect(marks['24100|CE|volume']).toBe('second_weak');
    expect(marks['24150|CE|volume']).toBeUndefined();
  });

  it('exactly 75% is still strong, so it is not marked', () => {
    const marks = highlightCells([row(24000, 1, 1000), row(23950, 1, 750)], LINE, 75);
    expect(marks['24000|PE|volume']).toBe('max');
    expect(marks['23950|PE|volume']).toBeUndefined();
  });

  it('skips missing values rather than reading them as zero', () => {
    const gap: ChainView = { ...row(23950, 1, 0), pe: null };
    const marks = highlightCells([row(24000, 1, 500), gap], LINE, 75);
    expect(marks['24000|PE|volume']).toBe('max');
    expect(Object.keys(marks).filter((k) => k.startsWith('23950|PE'))).toEqual([]);
  });
});

describe('healthBadge', () => {
  it('is green under 2 minutes, amber under 5, red from 5 minutes or with no snapshot', () => {
    expect(healthBadge(0)).toBe('green');
    expect(healthBadge(119)).toBe('green');
    expect(healthBadge(120)).toBe('amber');
    expect(healthBadge(299)).toBe('amber');
    expect(healthBadge(300)).toBe('red');
    expect(healthBadge(null)).toBe('red');
  });
});

describe('windowLabel', () => {
  it('COA 2.0 is valid from 09:45 to 14:30 inclusive', () => {
    expect(windowLabel('09:44')).toMatchObject({ state: 'before' });
    expect(windowLabel('09:45')).toMatchObject({ state: 'valid' });
    expect(windowLabel('14:30')).toMatchObject({ state: 'valid' });
    expect(windowLabel('14:31')).toMatchObject({ state: 'after' });
  });
  it('words the label for the screen', () => {
    expect(windowLabel('09:30').text).toBe('COA 2.0 starts at 09:45');
    expect(windowLabel('12:00').text).toBe('COA 2.0 valid (09:45–14:30)');
    expect(windowLabel('15:00').text).toBe('COA 2.0 window closed at 14:30');
  });
});

describe('columnPercents', () => {
  it('gives every cell as a percent of its column highest, in-the-money ones included', () => {
    const chain = [row(23900, 1, 1000), row(23950, 1, 800), row(24000, 1, 500), row(24050, 900, 1), row(24100, 450, 1)];
    const p = columnPercents(chain, LINE);
    expect(p['23900|PE|volume']).toBe(100);
    expect(p['23950|PE|volume']).toBe(80);
    expect(p['24100|CE|oi']).toBe(50);
    expect(p['24050|PE|volume']).toBeCloseTo(0.1, 5); // a put above the line counts too
  });
});

const makeChainSnap = (spot: number, pe: Record<number, { volume: number; oi: number }>, ce: Record<number, { volume: number; oi: number }>) => makeChain({ spot, step: 50, ts: istTs('2026-10-12', '09:30'), expiry: '2026-10-13', pe, ce });

describe('tradeLevels', () => {
  const analysis = (pe: Record<number, { volume: number; oi: number }>, ce: Record<number, { volume: number; oi: number }>, spot: number) => {
    const r = analyzeSession([makeChainSnap(spot, pe, ce)], { now: istTs('2026-10-12', '09:31') });
    if (r.empty || !r.usable) throw new Error('expected usable levels');
    return r;
  };
  it('Max Gain on the short side reads Break Down once the spot is below EOS, and not before', () => {
    const below = analysis({ 24050: { volume: 10000, oi: 10000 } }, { 24200: { volume: 10000, oi: 10000 } }, 24020); // EOS is about 24025, above the spot
    expect(tradeLevels(below).short.maxGain.broken).toBe('Break Down');
    const above = analysis({ 23900: { volume: 10000, oi: 10000 } }, { 24200: { volume: 10000, oi: 10000 } }, 24037);
    expect(tradeLevels(above).short.maxGain.broken).toBeNull();
  });
  it('rules out the long side in Blood Bath and the short side in Bull Run', () => {
    const r = analysis({ 23900: { volume: 10000, oi: 10000 } }, { 24200: { volume: 10000, oi: 10000 } }, 24037);
    expect(tradeLevels(r).ruledOut).toEqual({ short: r.direction.banner.kind === 'bull_run', long: r.direction.banner.kind === 'blood_bath' });
  });
});

describe('the scenario popup, as in the real tool', () => {
  const a = (soc: unknown, kind: 'blood_bath' | 'bull_run' | 'mixed', text: string) => ({ soc, direction: { banner: { kind, text } } }) as never;
  it('the title is the SOC text when a State of Confusion is active: "Bullish SOC- 3 hours"', () => {
    expect(popupTitle(a({ bias: 'bullish', type: '3h' }, 'mixed', 'Mixed'), 'SENSEX')).toBe('LTP Calculator – Bullish SOC- 3 hours');
    expect(popupTitle(a({ bias: 'bearish', type: '1h' }, 'blood_bath', 'Blood Bath'), 'NIFTY')).toBe('LTP Calculator – Bearish SOC- 1 hours');
  });
  it('without a SOC the title is the banner', () => {
    expect(popupTitle(a(null, 'blood_bath', 'Blood Bath'), 'NIFTY')).toBe('LTP Calculator – NIFTY IS IN BLOOD BATH');
    expect(popupTitle(a(null, 'bull_run', 'Bull Run'), 'NIFTY')).toBe('LTP Calculator – NIFTY IS IN BULL RUN');
    expect(popupTitle(a(null, 'mixed', 'Mixed'), 'NIFTY')).toBe('LTP Calculator – NIFTY SIDES DISAGREE');
  });
  it('a Strong label ends with a dash, like "71700 - STRONG -"; a weak one is unchanged', () => {
    expect(logLabel({ status: 'strong', label: '72000 - STRONG' })).toBe('72000 - STRONG -');
    expect(logLabel({ status: 'wtt', label: '72500 - WTT - 73000' })).toBe('72500 - WTT - 73000');
  });
  it('the time carries seconds', () => { expect(logTime(istTs('2026-10-12', '15:10'))).toBe('15:10:00'); });
});

describe('the numbered condition shown on the LTP screen', () => {
  const info = (over = {}) => ({ number: 5, exact: true, wording: 'INITIALLY WTT THEN BECAME STRONG', pressure: 'B' as const, phases: 2, currentPhaseMinutes: 135, continuation: true, ...over });
  it('writes a phase age in hours and minutes', () => {
    expect(phaseAge(0)).toBe('0m');
    expect(phaseAge(45)).toBe('45m');
    expect(phaseAge(60)).toBe('1h');
    expect(phaseAge(135)).toBe('2h 15m');
  });
  it('summarises a side: its number, the pressure in words, the phases and how long this phase has lasted, with continuation named', () => {
    expect(conditionSummary('S', info())).toBe('S5: bearish · 2 phases · 2h 15m in this phase (continuation)');
    expect(conditionSummary('R', info({ number: 1, pressure: 'HU', phases: 1, currentPhaseMinutes: 20, continuation: false }))).toBe('R1: highly bullish · 1 phase · 20m in this phase');
  });
  it('marks an approximate condition with a tilde and says so', () => {
    expect(conditionSummary('S', info({ exact: false }))).toMatch(/^S5~: bearish/);
    expect(conditionSummary('S', info({ exact: false }))).toMatch(/closest listed/);
  });
  it('the headline is the short signal tag, plus the State of Confusion when there is one', () => {
    const a = { coa1: { label: '6(S5/R1)', scenario: { number: 6 }, pressure: { support: 'B', resistance: 'HB' } }, soc: null } as never;
    expect(scenarioHeadline(a)).toBe('6(S5/R1) S-Bearish R-Bearish(H)');
    const withSoc = { coa1: { label: '8(S1/R2)', scenario: { number: 8 }, pressure: { support: 'B', resistance: 'U' } }, soc: { bias: 'bullish', type: '3h' } } as never;
    expect(scenarioHeadline(withSoc)).toBe('8(S1/R2) S-Bearish R-Bullish · Bullish SOC 3h');
  });
});
