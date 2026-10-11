import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EMPTY_PRIOR, foldDay, scanSymbol, type C5, type PriorTotals } from '@/lib/vwap/core';
import { signalsForDay, simulateDay, simulateSymbolMonth, type DayInput } from '@/lib/vwap/backtest/engine';
import { DEFAULT_FILTERS, type ExitRule } from '@/lib/vwap/backtest/types';

const DAY = '2026-10-07';
const T0 = Date.parse(`${DAY}T09:15:00+05:30`) / 1000;
// Yesterday closed below its VWAP of 100, so a close above the VWAP today is an up-cross.
const PRIOR: PriorTotals = { sumPv: 100 * 1000, sumV: 1000, lastClose: 99, lastVwap: 100 };
const k = (i: number, o: number, h: number, l: number, c: number, v = 100): C5 => ({ t: T0 + i * 300, o, h, l, c, v });
const input = (candles: C5[], prior: PriorTotals = PRIOR): DayInput => ({ day: DAY, month: '2026-10', sessionOfMonth: 4, symbol: 'NSE:X-EQ', sector: 'IT', candles, prior });
// c0 quiet below the VWAP; c1 crosses up (close 101.5); c2 is the entry candle, opening at 101.6.
const base = [k(0, 99.4, 99.6, 99.3, 99.5), k(1, 99.5, 102, 99.4, 101.5)];
const stopRule: ExitRule = { name: 'stop', stopPct: 1, targetR: 2 };

describe('entries', () => {
  it('enters at the OPEN of the candle after the signal, never at the signal candle', () => {
    const trades = simulateDay(input([...base, k(2, 101.6, 102, 101.2, 101.8), k(3, 101.8, 102, 101.5, 101.9)]), { name: 'eod' });
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ direction: 1, entryPrice: 101.6, entryT: T0 + 2 * 300, signalT: T0 + 300, signalType: 'close-cross', exitReason: 'end-of-day', exitPrice: 101.9 });
  });

  it('goes short on a down cross', () => {
    const prior = { ...PRIOR, lastClose: 101 };
    const candles = [k(0, 100.6, 100.7, 100.4, 100.5), k(1, 100.5, 100.6, 98, 98.5), k(2, 98.4, 98.6, 98.0, 98.2)];
    const trades = simulateDay(input(candles, prior), { name: 'eod' });
    expect(trades[0]).toMatchObject({ direction: -1, entryPrice: 98.4, signalType: 'close-cross' });
  });

  it('opens nothing when the signal comes on the day\'s last candle (there is no next open)', () => {
    expect(simulateDay(input([k(0, 99.4, 99.6, 99.3, 99.5), k(1, 99.5, 102, 99.4, 101.5)]), { name: 'eod' })).toEqual([]);
  });

  it('respects the entry window by the entry candle\'s start time', () => {
    const candles = [...base, k(2, 101.6, 102, 101.2, 101.8), k(3, 101.8, 102, 101.5, 101.9)];
    expect(simulateDay(input(candles), { name: 'eod' }, { ...DEFAULT_FILTERS, entryTo: '09:20' })).toEqual([]); // the entry would be at 09:25
    expect(simulateDay(input(candles), { name: 'eod' }, { ...DEFAULT_FILTERS, entryTo: '09:25' })).toHaveLength(1);
    expect(simulateDay(input(candles), { name: 'eod' }, { ...DEFAULT_FILTERS, entryFrom: '09:30' })).toEqual([]);
  });

  it('can restrict signal types and directions', () => {
    const candles = [...base, k(2, 101.6, 102, 101.2, 101.8), k(3, 101.8, 102, 101.5, 101.9)];
    expect(simulateDay(input(candles), { name: 'eod' }, { ...DEFAULT_FILTERS, types: ['gap-cross'] })).toEqual([]);
    expect(simulateDay(input(candles), { name: 'eod' }, { ...DEFAULT_FILTERS, directions: ['down'] })).toEqual([]);
  });

  it('skips a borderline cross when asked', () => {
    // The VWAP after c1 is about 99.937; a close of 99.97 is 0.034% above it, inside the 0.05% band.
    const candles = [k(0, 99.4, 99.6, 99.3, 99.5), k(1, 99.5, 100.0, 99.4, 99.97), k(2, 100.0, 100.4, 99.9, 100.2), k(3, 100.2, 100.5, 100.1, 100.4)];
    const event = signalsForDay(PRIOR, candles)[1]!;
    expect(event.borderline).toBe(true);
    expect(simulateDay(input(candles), { name: 'eod' })).toHaveLength(1);
    expect(simulateDay(input(candles), { name: 'eod' }, { ...DEFAULT_FILTERS, skipBorderline: true })).toEqual([]);
  });

  it('firstCrossOnly keeps only the first cross event of the day', () => {
    // Up at c1, down at c3, up at c5.
    const candles = [k(0, 99.4, 99.6, 99.3, 99.5), k(1, 99.5, 102, 99.4, 101.5), k(2, 101.5, 101.8, 101.2, 101.6), k(3, 101.6, 101.6, 98, 98.5), k(4, 98.5, 98.9, 98.3, 98.6), k(5, 98.6, 102.5, 98.5, 102), k(6, 102, 102.4, 101.8, 102.2), k(7, 102.2, 102.4, 102, 102.3)];
    expect(signalsForDay(PRIOR, candles).filter(Boolean).map((e) => e!.direction)).toEqual(['up', 'down', 'up']);
    const rule: ExitRule = { name: 'opp', opposite: true }; // exits on the opposite cross, so later signals can enter
    const all = simulateDay(input(candles), rule);
    const first = simulateDay(input(candles), rule, { ...DEFAULT_FILTERS, firstCrossOnly: true });
    expect(all.length).toBeGreaterThan(first.length);
    expect(first).toHaveLength(1);
    expect(first[0].signalT).toBe(T0 + 300);
  });

  it('holds one position at a time: a second signal in the same direction does not add a trade', () => {
    const candles = [...base, k(2, 101.6, 102, 101.2, 101.8), k(3, 101.8, 102.2, 98.9, 101.0), k(4, 101.0, 102.8, 100.9, 102.6), k(5, 102.6, 102.9, 102.2, 102.7)];
    expect(simulateDay(input(candles), { name: 'eod' }).length).toBeLessThanOrEqual(2);
  });
});

describe('exits', () => {
  it('stop-loss: exits at the stop price when the low touches it', () => {
    const candles = [...base, k(2, 101.6, 102, 100.5, 101), k(3, 101, 101.2, 100.9, 101.1)];
    const [t] = simulateDay(input(candles), stopRule);
    expect(t).toMatchObject({ exitReason: 'stop', exitPrice: 101.6 - 1.016 });
    expect(t.maePct).toBeCloseTo(-1, 6); // the stop is 1% below the entry
  });

  it('stop-loss: a gap through the stop fills at the open, not at the stop price', () => {
    const candles = [...base, k(2, 101.6, 101.8, 101.3, 101.5), k(3, 100.0, 100.4, 99.8, 100.1), k(4, 100.1, 100.3, 100, 100.2)];
    const [t] = simulateDay(input(candles), stopRule);
    expect(t).toMatchObject({ exitReason: 'stop-gap', exitPrice: 100.0, exitT: T0 + 3 * 300 });
    expect(t.exitPrice).toBeLessThan(101.6 - 1.016);
  });

  it('target: exits at entry + R x risk', () => {
    const candles = [...base, k(2, 101.6, 102, 101.2, 101.8), k(3, 101.8, 104, 101.5, 103.5), k(4, 103.5, 103.6, 103, 103.2)];
    const [t] = simulateDay(input(candles), stopRule);
    expect(t.exitReason).toBe('target');
    expect(t.exitPrice).toBeCloseTo(101.6 + 2 * 1.016, 8);
    expect(t.mfePct).toBeCloseTo((2 * 1.016 / 101.6) * 100, 6);
  });

  it('target: a gap above the target fills at the open', () => {
    const candles = [...base, k(2, 101.6, 102, 101.2, 101.8), k(3, 104.5, 105, 104.1, 104.8), k(4, 104.8, 105, 104.6, 104.9)];
    const [t] = simulateDay(input(candles), stopRule);
    expect(t).toMatchObject({ exitReason: 'target-gap', exitPrice: 104.5 });
  });

  it('when one candle touches both the stop and the target, the stop is assumed to have been hit first', () => {
    const candles = [...base, k(2, 101.6, 104, 100.4, 102), k(3, 102, 102.2, 101.8, 102.1)];
    const [t] = simulateDay(input(candles), stopRule);
    expect(t.exitReason).toBe('stop');
  });

  it('trailing stop: follows the best price after each completed candle and exits when touched', () => {
    const candles = [...base, k(2, 101.6, 103, 101.2, 102.9), k(3, 102.5, 102.8, 101.9, 102.0), k(4, 102, 102.1, 101.9, 102)];
    const [t] = simulateDay(input(candles), { name: 'trail', trailPct: 1 });
    // After c2 the peak is 103, so the stop is 103 x 0.99 = 101.97. c3 trades down to 101.9 and is stopped there.
    expect(t.exitReason).toBe('trail');
    expect(t.exitPrice).toBeCloseTo(103 * 0.99, 8);
    expect(t.exitT).toBe(T0 + 3 * 300);
  });

  it('trailing stop never uses the high of the candle it protects', () => {
    // c2 spikes to 110 and falls back to 101.2 inside the same candle. The stop for c2 is still the initial 100.584, so c2 does not exit.
    // Only once c2 has completed does the stop move up to 108.9 (110 x 0.99), and c3, opening at 101.5, gaps through it.
    const candles = [...base, k(2, 101.6, 110, 101.2, 101.5), k(3, 101.5, 101.6, 101.3, 101.4)];
    const [t] = simulateDay(input(candles), { name: 'trail', trailPct: 1 });
    expect(t.exitT).toBe(T0 + 3 * 300);
    expect(t).toMatchObject({ exitReason: 'trail-gap', exitPrice: 101.5 });
  });

  it('opposite cross: exits at the next open and, on the same open, enters the other way', () => {
    const candles = [...base, k(2, 101.6, 101.8, 101.3, 101.5), k(3, 101.5, 101.5, 98, 98.5), k(4, 98.4, 98.6, 98.1, 98.3), k(5, 98.3, 98.5, 98.0, 98.2)];
    const trades = simulateDay(input(candles), { name: 'opp', opposite: true });
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ direction: 1, exitReason: 'opposite-cross', exitPrice: 98.4, exitT: T0 + 4 * 300 });
    expect(trades[1]).toMatchObject({ direction: -1, entryPrice: 98.4, entryT: T0 + 4 * 300 });
  });

  it('without the opposite rule, an opposite cross does not close the trade', () => {
    const candles = [...base, k(2, 101.6, 101.8, 101.3, 101.5), k(3, 101.5, 101.5, 98, 98.5), k(4, 98.4, 98.6, 98.1, 98.3), k(5, 98.3, 98.5, 98.0, 98.2)];
    const trades = simulateDay(input(candles), { name: 'hold' });
    expect(trades).toHaveLength(1);
    expect(trades[0].exitReason).toBe('end-of-day');
  });

  it('square-off: exits at the open of the first candle at or after the time, and takes no entry after it', () => {
    const flat = (i: number) => k(i, 101.5, 101.6, 101.4, 101.5);
    const candles = [...base, ...Array.from({ length: 73 }, (_, n) => flat(n + 2))]; // 75 candles, 09:15 to 15:25
    const [t] = simulateDay(input(candles), { name: 'time', squareoffAt: '15:15' });
    expect(t).toMatchObject({ exitReason: 'square-off', exitT: T0 + 72 * 300 }); // the 15:15 candle
    expect(t.holdMinutes).toBe((72 - 2) * 5);
    // A cross at 15:10 would enter at 15:15, which is not before the square-off time: no trade.
    const late = [...Array.from({ length: 71 }, (_, n) => k(n, 99.4, 99.6, 99.3, 99.5)), k(71, 99.5, 102, 99.4, 101.5), ...Array.from({ length: 3 }, (_, n) => k(72 + n, 101.5, 101.6, 101.4, 101.5))];
    expect(signalsForDay(PRIOR, late)[71]).not.toBeNull(); // the cross really is on the 15:10 candle
    expect(simulateDay(input(late), { name: 'time', squareoffAt: '15:15' }, { ...DEFAULT_FILTERS, entryTo: '15:20' })).toEqual([]);
  });

  it('records the worst and best moves against and for the position', () => {
    const candles = [...base, k(2, 101.6, 102.6, 101.0, 101.8), k(3, 101.8, 102.0, 101.7, 101.9)];
    const [t] = simulateDay(input(candles), { name: 'eod' });
    expect(t.mfePct).toBeCloseTo(((102.6 - 101.6) / 101.6) * 100, 8);
    expect(t.maePct).toBeCloseTo(((101.0 - 101.6) / 101.6) * 100, 8);
  });
});

describe('no look-ahead', () => {
  const longDay = (): C5[] => [...base, k(2, 101.6, 102, 101.2, 101.8), k(3, 101.8, 101.9, 98, 98.5), k(4, 98.5, 98.9, 98.3, 98.6), k(5, 98.6, 102.5, 98.5, 102), k(6, 102, 102.4, 101.8, 102.2), k(7, 102.2, 102.4, 102, 102.3)];

  it('changing any candle after index n changes no signal at or before n', () => {
    const original = signalsForDay(PRIOR, longDay());
    for (let n = 0; n < 7; n += 1) {
      const mutated = longDay().map((c, i) => (i > n ? { ...c, o: c.o * 1.2, h: c.h * 1.5, l: c.l * 0.5, c: c.c * 0.7, v: c.v * 40 } : c));
      const after = signalsForDay(PRIOR, mutated);
      expect(after.slice(0, n + 1)).toEqual(original.slice(0, n + 1));
    }
  });

  it('changing candles after time t changes no entry at or before t', () => {
    const rule: ExitRule = { name: 'opp', opposite: true };
    const original = simulateDay(input(longDay()), rule);
    for (let n = 1; n < 7; n += 1) {
      const cutoff = T0 + (n + 1) * 300; // entries at or before candle n + 1's open can only depend on candles up to n
      const mutated = longDay().map((c, i) => (i > n ? { ...c, o: c.o * 1.2, h: c.h * 1.5, l: c.l * 0.5, c: c.c * 0.7, v: c.v * 40 } : c));
      const after = simulateDay(input(mutated), rule);
      // Whether and when to enter, and in which direction, cannot depend on later candles. (The fill price is the next open, which is
      // itself a later candle, so it is not compared.)
      const early = (ts: { entryT: number; direction: number }[]) => ts.filter((x) => x.entryT <= cutoff).map((x) => [x.entryT, x.direction]);
      expect(early(after)).toEqual(early(original));
    }
  });
});

describe('parity with the live scanner on real data', () => {
  type Fixture = { days: Record<string, number[][]> };
  const candlesOf = (rows: number[][]): C5[] => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

  for (const name of ['tcs', 'ofss', 'ltm']) {
    it(`${name.toUpperCase()}: the engine's signals on 7 October equal the live scanner's events`, () => {
      const fixture = JSON.parse(readFileSync(`tests/fixtures/vwap/${name}.json`, 'utf8')) as Fixture;
      let prior: PriorTotals = EMPTY_PRIOR;
      for (const d of ['2026-10-01', '2026-10-05', '2026-10-06']) prior = foldDay(prior, candlesOf(fixture.days[d]));
      const candles = candlesOf(fixture.days['2026-10-07']);
      const live = scanSymbol(prior, candles).events;
      const engine = signalsForDay(prior, candles).filter((e) => e !== null);
      expect(engine).toEqual(live);
      expect(engine.length).toBeGreaterThan(0);
    });
  }

  it('a whole symbol-month run reproduces the same crosses, day by day', () => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/vwap/ltm.json', 'utf8')) as Fixture;
    const days = new Map(Object.entries(fixture.days).filter(([d]) => d <= '2026-10-07').map(([d, rows]) => [d, candlesOf(rows)]));
    const trades = simulateSymbolMonth({ symbol: 'NSE:LTM-EQ', sector: 'IT', month: '2026-10', days }, [{ name: 'opp', opposite: true, squareoffAt: '15:15' }]);
    const oct7 = trades.filter((t) => t.day === '2026-10-07');
    // The four 7 October crosses (10:15 up, 10:20 down, 10:45 up, 11:00 down) each signal an entry at the following open.
    expect(oct7.map((t) => [t.signalT, t.direction])).toEqual([
      [Date.parse('2026-10-07T10:15:00+05:30') / 1000, 1], [Date.parse('2026-10-07T10:20:00+05:30') / 1000, -1],
      [Date.parse('2026-10-07T10:45:00+05:30') / 1000, 1], [Date.parse('2026-10-07T11:00:00+05:30') / 1000, -1],
    ]);
    expect(trades.every((t) => t.month === '2026-10')).toBe(true);
  });
});
