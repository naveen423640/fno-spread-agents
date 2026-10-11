import { describe, expect, it } from 'vitest';

import { EMPTY_PRIOR, foldDay, scanSymbol, type C5, type PriorTotals } from '@/lib/vwap/core';

const T0 = Date.parse('2026-10-07T09:15:00+05:30') / 1000;
// A candle whose typical price equals its close (high = low = close) keeps the VWAP arithmetic hand-checkable.
const flat = (i: number, price: number, v = 100): C5 => ({ t: T0 + i * 300, o: price, h: price, l: price, c: price, v });
const candle = (i: number, o: number, h: number, l: number, c: number, v = 100): C5 => ({ t: T0 + i * 300, o, h, l, c, v });
const prior = (lastClose: number, lastVwap: number): PriorTotals => ({ sumPv: lastVwap * 1000, sumV: 1000, lastClose, lastVwap });

describe('VWAP arithmetic', () => {
  it('is the cumulative typical-price-times-volume over cumulative volume, anchored with the prior totals', () => {
    const r = scanSymbol(EMPTY_PRIOR, [candle(0, 10, 12, 8, 10, 100), candle(1, 10, 14, 10, 12, 300)]);
    // typical prices: (12+8+10)/3 = 10 and (14+10+12)/3 = 12 -> (10*100 + 12*300) / 400 = 11.5
    expect(r.vwap).toBeCloseTo(11.5, 10);
    expect(r.totals.sumV).toBe(400);
    const next = scanSymbol(r.totals, [flat(0, 13, 200)]);
    expect(next.vwap).toBeCloseTo((11.5 * 400 + 13 * 200) / 600, 10);
  });

  it('foldDay gives the same totals as scanning the day', () => {
    const day = [candle(0, 10, 12, 8, 10), candle(1, 10, 14, 10, 12)];
    expect(foldDay(EMPTY_PRIOR, day)).toEqual(scanSymbol(EMPTY_PRIOR, day).totals);
  });
});

describe('cross detection', () => {
  it('reports an up close-cross: previous close below the previous VWAP, this close above the VWAP', () => {
    const r = scanSymbol(prior(99, 100), [flat(0, 99.5), flat(1, 101)]);
    // VWAP after candle 1 = (100*1000 + 99.5*100 + 101*100) / 1200 = 99.99.. -> 101 is above it
    const up = r.events.find((e) => e.t === T0 + 300)!;
    expect(up).toMatchObject({ direction: 'up', type: 'close-cross', time: '09:20' });
  });

  it('reports a down close-cross as the mirror image', () => {
    const r = scanSymbol(prior(101, 100), [flat(0, 100.6), flat(1, 98)]);
    expect(r.events.find((e) => e.t === T0 + 300)).toMatchObject({ direction: 'down', type: 'close-cross' });
  });

  it('reports a body-cross: the candle opens below the VWAP and closes above it with no change of side at the previous close', () => {
    // Previous close is already above the previous VWAP; the candle dips to open under the VWAP and closes back above.
    const r = scanSymbol(prior(100.4, 100), [candle(0, 100.5, 101, 100.2, 100.8), candle(1, 99.5, 101.2, 99.4, 101)]);
    const second = r.events.find((e) => e.t === T0 + 300)!;
    expect(second).toMatchObject({ direction: 'up', type: 'body-cross' });
  });

  it('flags a gap-cross on the first candle: yesterday below the VWAP, the open already above it', () => {
    const r = scanSymbol(prior(98, 100), [candle(0, 102, 103, 101.5, 102.5)]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ direction: 'up', type: 'gap-cross', time: '09:15' });
    expect(r.firstGapPct).toBeCloseTo((102 / 98 - 1) * 100, 8);
  });

  it('compares the first candle with the previous session, so a close-cross can happen on it', () => {
    const r = scanSymbol(prior(98, 100), [candle(0, 99, 101.5, 98.8, 101)]);
    expect(r.events[0]).toMatchObject({ direction: 'up', type: 'close-cross' });
  });

  it('does not report a cross for a close exactly on the VWAP', () => {
    const r = scanSymbol(prior(99, 100), [flat(0, 100)]);
    expect(r.events).toEqual([]);
  });

  it('reports nothing while the price stays on one side', () => {
    const r = scanSymbol(prior(101, 100), [flat(0, 101.2), flat(1, 101.4), flat(2, 101.1)]);
    expect(r.events).toEqual([]);
    expect(r.side).toBe('above');
  });

  it('counts several crosses in a day in order', () => {
    const r = scanSymbol(prior(99, 100), [flat(0, 100.5), flat(1, 99.2), flat(2, 100.9), flat(3, 99.0)]);
    expect(r.events.map((e) => e.direction)).toEqual(['up', 'down', 'up', 'down']);
    expect(r.crossesToday).toBe(4);
  });
});

describe('borderline and wick touches', () => {
  it('flags a cross that closes within 0.05% of the VWAP as borderline, and a clear one as clean', () => {
    const near = scanSymbol(prior(99, 100), [flat(0, 100.03)]);
    expect(near.events[0].borderline).toBe(true);
    expect(near.borderlineNow).toBe(true);
    const clear = scanSymbol(prior(99, 100), [flat(0, 101)]);
    expect(clear.events[0].borderline).toBe(false);
    expect(clear.borderlineNow).toBe(false);
  });

  it('records a wick touch when the VWAP is inside the range but the close did not cross', () => {
    const r = scanSymbol(prior(101, 100), [candle(0, 101.5, 101.8, 99.9, 101.3)]);
    expect(r.events).toEqual([]);
    expect(r.wickTouches).toHaveLength(1);
    expect(r.wickTouches[0].low).toBe(99.9);
  });

  it('does not count a wick touch on a candle that did cross', () => {
    const r = scanSymbol(prior(99, 100), [candle(0, 99.5, 101.5, 99.4, 101)]);
    expect(r.events).toHaveLength(1);
    expect(r.wickTouches).toEqual([]);
  });
});

describe('closed candles only', () => {
  it('leaves out the candle that is still forming', () => {
    const candles = [flat(0, 99.5), flat(1, 101)];
    const now = T0 + 300 + 120; // two minutes into the second candle
    const r = scanSymbol(prior(99, 100), candles, { now });
    expect(r.candlesUsed).toBe(1);
    expect(r.formingExcluded).toBe(true);
    expect(r.lastClose).toBe(99.5);
    expect(r.events).toEqual([]);
  });

  it('includes a candle exactly when its five minutes are over', () => {
    const r = scanSymbol(prior(99, 100), [flat(0, 101)], { now: T0 + 300 });
    expect(r.candlesUsed).toBe(1);
    expect(r.formingExcluded).toBe(false);
  });

  it('does not let a forming candle change the VWAP', () => {
    const closedOnly = scanSymbol(prior(99, 100), [flat(0, 99.5)]);
    const withForming = scanSymbol(prior(99, 100), [flat(0, 99.5), flat(1, 120, 99999)], { now: T0 + 400 });
    expect(withForming.vwap).toBe(closedOnly.vwap);
  });
});

describe('zero volume, month start and bad input', () => {
  it('has no VWAP and no events while nothing has traded', () => {
    const r = scanSymbol(EMPTY_PRIOR, [flat(0, 100, 0), flat(1, 101, 0)]);
    expect(r.vwap).toBeNull();
    expect(r.events).toEqual([]);
    expect(r.flags.join(' ')).toMatch(/no volume/);
  });

  it('a zero-volume candle later in the day leaves the VWAP unchanged and cannot create a cross', () => {
    const r = scanSymbol(prior(99, 100), [flat(0, 99.5), flat(1, 99.5, 0), flat(2, 99.5, 0)]);
    expect(r.events).toEqual([]);
    expect(r.vwap).toBeCloseTo((100 * 1000 + 99.5 * 100) / 1100, 10);
  });

  it('reports no cross on the first candle of a month, because there is no previous VWAP to compare with', () => {
    const r = scanSymbol(EMPTY_PRIOR, [candle(0, 99, 103, 98, 102), flat(1, 98)]);
    expect(r.events.find((e) => e.t === T0)).toBeUndefined();
    expect(r.flags.join(' ')).toMatch(/first session of the month/);
    // Later candles in that first session compare normally.
    expect(r.events.find((e) => e.t === T0 + 300)).toMatchObject({ direction: 'down' });
  });

  it('month rollover: starting again from empty totals forgets the old month', () => {
    const october = scanSymbol(EMPTY_PRIOR, [flat(0, 100, 500)]);
    const november = scanSymbol(EMPTY_PRIOR, [flat(0, 200, 500)]);
    expect(october.vwap).toBe(100);
    expect(november.vwap).toBe(200);
  });

  it('handles an empty candle list and unsorted or duplicated candles', () => {
    expect(scanSymbol(prior(99, 100), [])).toMatchObject({ vwap: null, candlesUsed: 0, events: [], side: null });
    const messy = scanSymbol(prior(99, 100), [flat(1, 101), flat(0, 99.5), flat(0, 99.5)]);
    expect(messy.candlesUsed).toBe(2);
    expect(messy.events.map((e) => e.t)).toEqual([T0 + 300]);
  });
});
