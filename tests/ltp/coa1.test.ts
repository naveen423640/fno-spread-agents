import { describe, expect, it } from 'vitest';

import { COA1_TABLE, countHits, hitLabel, scenarioLevels, selectCoa1, tradeMapping } from '@/lib/ltp/coa1';
import { extensionLevels, writerBreakeven } from '@/lib/ltp/extensions';
import { computeLevels } from '@/lib/ltp/levels';
import { statusOf } from '@/lib/ltp/strength';
import type { Status } from '@/lib/ltp/types';
import { makeChain } from '../support/ltp-chain';

// The brief's table, typed out here independently of the implementation: [support, resistance, number, bias, top, bottom, allowed, tradable].
const BRIEF: [Status, Status, number, string, string | null, string | null, string[], boolean][] = [
  ['strong', 'strong', 1, 'Both ways', 'EOR', 'EOS', ['long at EOS', 'short at EOR'], true],
  ['strong', 'wtb', 2, 'Bearish (support expected to break)', 'EOR', 'EOS-1', ['short at EOR', 'long only at EOS-1'], true],
  ['strong', 'wtt', 3, 'Bullish (resistance expected to break)', 'WTT-1', 'EOS', ['long at EOS', 'short only at WTT-1'], true],
  ['wtb', 'strong', 4, 'Bearish', 'EOR', 'WTB+1', ['short at EOR', 'long only at WTB+1'], true],
  ['wtt', 'strong', 5, 'Bullish', 'EOR+1', 'EOS', ['long at EOS', 'short only at EOR+1'], true],
  ['wtb', 'wtb', 6, 'Blood Bath (highly bearish)', 'EOR', null, ['no longs'], true],
  ['wtt', 'wtt', 7, 'Bull Run (highly bullish)', null, 'EOS', ['no shorts'], true],
  ['wtb', 'wtt', 8, 'Not tradable', null, null, ['wait for a level to turn Strong'], false],
  ['wtt', 'wtb', 9, 'Not tradable', null, null, ['wait for a level to turn Strong'], false],
];

describe('COA 1.0 table (C5)', () => {
  it('has exactly the nine combinations', () => {
    expect(Object.keys(COA1_TABLE)).toHaveLength(9);
  });

  for (const [support, resistance, number, bias, top, bottom, allowed, tradable] of BRIEF) {
    it(`scenario ${number}: support ${support} / resistance ${resistance}`, () => {
      expect(selectCoa1(support, resistance)).toEqual({ number, bias, top, bottom, allowed, tradable });
    });
  }

  it('maps the reversal labels to the extension levels of a snapshot', () => {
    const s = makeChain({ spot: 24037, step: 50, pe: { 23900: { volume: 9000, oi: 9000, ltp: 40 }, 23850: { ltp: 30 } }, ce: { 24200: { volume: 9000, oi: 9000, ltp: 55 }, 24250: { ltp: 45 } } });
    const l = computeLevels(s)!;
    const ext = extensionLevels(s, l, statusOf('support', l.support, l.line), statusOf('resistance', l.resistance, l.line), writerBreakeven);
    const two = scenarioLevels(selectCoa1('strong', 'wtb'), ext);
    expect(two.top?.label).toBe('EOR (proxy: writer breakeven)');
    expect(two.bottom?.label).toBe('EOS-1 (proxy: writer breakeven)');
    expect(two.bottom?.value).toBe(23850 - 30);
    const five = scenarioLevels(selectCoa1('wtt', 'strong'), ext);
    expect(five.top?.label).toBe('EOR+1 (proxy: writer breakeven)');
    expect(scenarioLevels(selectCoa1('wtb', 'wtt'), ext)).toEqual({ top: null, bottom: null });
    expect(scenarioLevels(selectCoa1('strong', 'strong'), ext).bottom?.label).toBe('EOS (proxy: writer breakeven)');
  });

  it('a label with no value yet (for example WTB+1 when the support is not WTB) gives no level rather than a wrong one', () => {
    // A clear leader on each side makes both levels Strong, so there is no WTB strike to build WTB+1 from.
    const s = makeChain({ spot: 24037, step: 50, pe: { 23900: { volume: 9000, oi: 9000 } }, ce: { 24200: { volume: 9000, oi: 9000 } } });
    const l = computeLevels(s)!;
    const ext = extensionLevels(s, l, statusOf('support', l.support, l.line), statusOf('resistance', l.resistance, l.line), writerBreakeven);
    expect(scenarioLevels(selectCoa1('wtb', 'strong'), ext).bottom).toBeNull();
  });
});

describe('trade mapping and the hit counter', () => {
  it('maps the two reversal ends to the trades the brief lists (display only)', () => {
    expect(tradeMapping('bottom')).toEqual(['buy CE', 'buy futures', 'sell PE']);
    expect(tradeMapping('top')).toEqual(['buy PE', 'sell futures', 'sell CE']);
  });

  it('counts a touch each time the price comes within the tolerance after having been outside it', () => {
    expect(countHits([90, 100.2, 100, 99.9, 110, 100.4, 95], 100, 0.5)).toBe(2);
    expect(countHits([90, 91, 92], 100, 0.5)).toBe(0);
    expect(countHits([100, 100.1, 99.9], 100, 0.5)).toBe(1); // starting on the level is the first touch
    expect(countHits([100, 101], null, 0.5)).toBe(0);
  });

  it('labels the first touch generally safe and later ones risk rising', () => {
    expect(hitLabel(0)).toBeNull();
    expect(hitLabel(1)).toBe('generally safe');
    expect(hitLabel(2)).toBe('risk rising');
    expect(hitLabel(5)).toBe('risk rising');
  });
});
