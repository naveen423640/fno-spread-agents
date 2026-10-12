import { describe, expect, it } from 'vitest';

import { selectDetailed, type Pressure } from '@/lib/ltp/coa1-detailed';
import type { Status } from '@/lib/ltp/types';

const pick = (s: Pressure, r: Pressure, sStatus: Status = 'strong', rStatus: Status = 'strong') => selectDetailed(s, r, sStatus, rStatus);

// docs/ltp-rules-reference.md part 7.2, typed out independently: [support, resistance, top, bottom].
const TABLE: [Pressure, Pressure, string | null, string | null][] = [
  ['S', 'S', 'EOR', 'EOS'], ['S', 'B', 'EOR', 'EOS-1'], ['S', 'U', 'EOR+1', 'EOS'], ['S', 'HB', 'EOR', null], ['S', 'HU', null, 'EOS'],
  ['B', 'S', 'EOR', 'EOS-1'], ['B', 'B', 'EOR', null], ['B', 'U', 'EOR+1', 'EOS-1'], ['B', 'HU', 'EOR+1', 'EOS'],
  ['U', 'S', 'EOR+1', 'EOS'], ['U', 'B', 'EOR+1', 'EOS-1'], ['U', 'U', null, 'EOS'], ['U', 'HB', 'EOR', 'EOS-1'],
  ['HB', 'S', 'EOR', null], ['HB', 'U', 'EOR', 'EOS-1'], ['HB', 'HB', 'EOR', null],
  ['HU', 'S', null, 'EOS'], ['HU', 'B', 'EOR+1', 'EOS'], ['HU', 'HU', null, 'EOS'],
];

describe('Detailed Chart of Accuracy 1.0', () => {
  for (const [s, r, top, bottom] of TABLE) {
    it(`support ${s} / resistance ${r}: top ${top ?? 'none'}, bottom ${bottom ?? 'none'}`, () => {
      const d = pick(s, r);
      expect([d.top, d.bottom]).toEqual([top, bottom]);
      expect(d.tradable).toBe(true);
    });
  }
  it('highly bearish with highly bullish is the rare scenario: not tradable', () => {
    for (const d of [pick('HB', 'HU'), pick('HU', 'HB')]) expect(d).toMatchObject({ top: null, bottom: null, tradable: false });
  });
  it('pairs the chart does not list read as their plain pressure (HB as B, HU as U)', () => {
    expect([pick('B', 'HB').top, pick('B', 'HB').bottom]).toEqual(['EOR', null]);
    expect([pick('HB', 'B').top, pick('HB', 'B').bottom]).toEqual(['EOR', null]);
    expect([pick('U', 'HU').top, pick('U', 'HU').bottom]).toEqual([null, 'EOS']);
  });
  it('a side that is weak right now gives WTB+1 as the bottom and WTT-1 as the top', () => {
    expect(pick('B', 'S', 'wtb', 'strong').bottom).toBe('WTB+1'); // scenario 4
    expect(pick('S', 'U', 'strong', 'wtt').top).toBe('WTT-1'); // scenario 3
    expect(pick('B', 'U', 'wtb', 'wtt')).toMatchObject({ top: 'WTT-1', bottom: 'WTB+1' }); // scenario 8, tradable
    expect(pick('S', 'U', 'strong', 'strong').top).toBe('EOR+1'); // strong now, bullish history: plain EOR+1
  });
  it('keeps the numbered scenario of the basic chart (WTB/B-type = bearish, WTT/U-type = bullish)', () => {
    expect(pick('S', 'S').number).toBe(1);
    expect(pick('S', 'B').number).toBe(2);
    expect(pick('S', 'U').number).toBe(3);
    expect(pick('B', 'S').number).toBe(4);
    expect(pick('U', 'S').number).toBe(5);
    expect(pick('B', 'B').number).toBe(6);
    expect(pick('HB', 'S').number).toBe(4);
    expect(pick('U', 'U').number).toBe(7);
    expect(pick('B', 'U').number).toBe(8);
    expect(pick('U', 'B').number).toBe(9);
  });
  it('lists what is allowed from the levels', () => {
    expect(pick('B', 'B').allowed).toEqual(['short at EOR', 'no longs']);
    expect(pick('U', 'U').allowed).toEqual(['no shorts', 'long at EOS']);
    expect(pick('B', 'U').allowed).toEqual(['short at EOR+1', 'long at EOS-1']);
  });
});
