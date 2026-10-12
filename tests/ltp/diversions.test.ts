import { describe, expect, it } from 'vitest';

import { diversionCount, diversionPath } from '@/lib/ltp/diversions';
import { timeValueOnly, writerBreakeven } from '@/lib/ltp/extensions';
import { makeChain } from '../support/ltp-chain';

describe('diversionCount (C7)', () => {
  it('17600 / 17700 with step 50 is 2', () => expect(diversionCount(17600, 17700, 50)).toBe(2));
  it('550 / 560 with step 10 is 1', () => expect(diversionCount(550, 560, 10)).toBe(1));
  it('the same strike on both sides is 0', () => expect(diversionCount(41500, 41500, 100)).toBe(0));
  it('does not depend on which strike is passed first', () => expect(diversionCount(17700, 17600, 50)).toBe(2));
  it('is the number of strikes strictly between plus one', () => expect(diversionCount(24000, 24250, 50)).toBe(5)); // 24050, 24100, 24150, 24200 between
});

describe('diversionPath (C7)', () => {
  const s = makeChain({ spot: 17650, step: 50, strikes: [17550, 17600, 17650, 17700, 17750], ce: { 17650: { ltp: 30 }, 17700: { ltp: 12 } }, pe: { 17650: { ltp: 28 }, 17700: { ltp: 70 } } });

  it('bullish path from support 17600 to resistance 17700: a call-side diversion then a put-side end of diversion at each strike above the support', () => {
    const path = diversionPath(s, 17600, 17700, 'bullish', writerBreakeven);
    expect(path.map((p) => [p.kind, p.strike, p.price])).toEqual([
      ['diversion', 17650, 17650 + 30], ['end_of_diversion', 17650, 17650 - 28],
      ['diversion', 17700, 17700 + 12], ['end_of_diversion', 17700, 17700 - 70],
    ]);
    expect(path.filter((p) => p.kind === 'diversion')).toHaveLength(diversionCount(17600, 17700, 50));
    expect(path.every((p) => p.isProxy && p.method === 'writer_breakeven')).toBe(true);
  });

  it('bearish path is the mirror: from resistance down, put-side diversions and call-side ends of diversion', () => {
    const path = diversionPath(s, 17600, 17700, 'bearish', writerBreakeven);
    expect(path.map((p) => [p.kind, p.strike, p.price])).toEqual([
      ['diversion', 17650, 17650 - 28], ['end_of_diversion', 17650, 17650 + 30],
      ['diversion', 17600, 17600 - 100], ['end_of_diversion', 17600, 17600 + 100],
    ]);
    expect(path.filter((p) => p.kind === 'diversion')).toHaveLength(2);
  });

  it('is empty when support and resistance are the same strike', () => {
    expect(diversionPath(s, 17650, 17650, 'bullish', writerBreakeven)).toEqual([]);
  });

  it('uses whichever extension method it is given, and a missing LTP gives a null price', () => {
    const a = diversionPath(s, 17600, 17700, 'bullish', writerBreakeven);
    const b = diversionPath(s, 17600, 17700, 'bullish', timeValueOnly);
    expect(b).toHaveLength(a.length);
    expect(b.every((p) => p.method === 'time_value_only')).toBe(true);
    const m = makeChain({ spot: 17650, step: 50, strikes: [17600, 17650, 17700], ce: { 17650: { ltp: null } } });
    expect(diversionPath(m, 17600, 17700, 'bullish', writerBreakeven)[0].price).toBeNull();
  });
});
