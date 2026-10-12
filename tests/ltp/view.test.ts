import { describe, expect, it } from 'vitest';

import { analyzeSession } from '@/lib/ltp/analyze';
import { istTs } from '@/lib/ltp/time';
import { columnPercents, highlightCells, healthBadge, tradeLevels, windowLabel } from '@/lib/ltp/view';
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
    expect(marks['24050|PE|volume']).toBeUndefined(); // puts above the line are not searched
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
  it('gives each searched cell as a percent of its column highest, and nothing outside the search side', () => {
    const chain = [row(23900, 1, 1000), row(23950, 1, 800), row(24000, 1, 500), row(24050, 900, 1), row(24100, 450, 1)];
    const p = columnPercents(chain, LINE);
    expect(p['23900|PE|volume']).toBe(100);
    expect(p['23950|PE|volume']).toBe(80);
    expect(p['24100|CE|oi']).toBe(50);
    expect(p['24050|PE|volume']).toBeUndefined();
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
