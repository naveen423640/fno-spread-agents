import { describe, expect, it } from 'vitest';

import { simulateDay } from '@/lib/vwap/backtest/engine';
import { DEFAULT_FILTERS } from '@/lib/vwap/backtest/types';
import { parseConfig } from '@/lib/vwap/backtest/config';
import { indexAllows, indexSidesByDay, type IndexSide } from '@/lib/vwap/backtest/index-filter';
import { loadIndexHistory } from '@/lib/vwap/backtest/index-load';
import { runBacktest } from '@/lib/vwap/backtest/run';
import type { DataProvider } from '@/lib/vwap/provider';
import type { SymbolMaster } from '@/lib/vwap/backtest/symbol-master';
import type { C5, PriorTotals } from '@/lib/vwap/core';

const T = (day: string, i: number) => Date.parse(`${day}T09:15:00+05:30`) / 1000 + i * 300;
const c = (day: string, i: number, o: number, h: number, l: number, cl: number, v = 100): C5 => ({ t: T(day, i), o, h, l, c: cl, v });

describe('indexSidesByDay: vwap-side', () => {
  it('compares each index close with the index VWAP so far, using only candles up to it', () => {
    // 100 flat, then a close at 101: VWAP after c1 = (100 x 100 + typical 101 x 100) / 200 = 100.5, so 101 is above and a later 99 below.
    const days = new Map([['2026-10-05', [c('2026-10-05', 0, 100, 100, 100, 100), c('2026-10-05', 1, 100, 101, 100, 101), c('2026-10-05', 2, 101, 101, 98, 98)]]]);
    const sides = indexSidesByDay(days, 'vwap-side').get('2026-10-05')!;
    expect(sides.get(T('2026-10-05', 0))).toBe(0); // the first close is the VWAP itself
    expect(sides.get(T('2026-10-05', 1))).toBe(1);
    expect(sides.get(T('2026-10-05', 2))).toBe(-1);
  });

  it('has no reading before anything has traded', () => {
    const days = new Map([['2026-10-05', [c('2026-10-05', 0, 100, 100, 100, 100, 0), c('2026-10-05', 1, 100, 101, 100, 101, 100)]]]);
    const sides = indexSidesByDay(days, 'vwap-side').get('2026-10-05')!;
    expect(sides.get(T('2026-10-05', 0))).toBeNull();
    expect(sides.get(T('2026-10-05', 1))).toBe(1); // only the second candle has traded: VWAP 100.67, close 101
  });

  it('restarts the VWAP at a new month but carries it across days inside one', () => {
    const days = new Map([
      ['2026-09-30', [c('2026-09-30', 0, 200, 200, 200, 200, 1000)]],
      ['2026-10-01', [c('2026-10-01', 0, 100, 100, 100, 100)]],
      ['2026-10-05', [c('2026-10-05', 0, 150, 150, 150, 150)]],
    ]);
    const sides = indexSidesByDay(days, 'vwap-side');
    expect(sides.get('2026-10-01')!.get(T('2026-10-01', 0))).toBe(0); // October's VWAP starts at 100, not blended with September's 200
    expect(sides.get('2026-10-05')!.get(T('2026-10-05', 0))).toBe(1); // 150 against a VWAP near 100
  });

  it('cannot see later candles: changing them leaves earlier readings unchanged', () => {
    const base = [c('2026-10-05', 0, 100, 100, 100, 100), c('2026-10-05', 1, 100, 101, 100, 101), c('2026-10-05', 2, 101, 102, 100, 101.5), c('2026-10-05', 3, 101.5, 102, 101, 101.7)];
    const mutated = base.map((x, i) => (i > 1 ? { ...x, c: x.c * 0.5, h: x.h * 0.5, l: x.l * 0.5, v: x.v * 50 } : x));
    const a = indexSidesByDay(new Map([['2026-10-05', base]]), 'vwap-side').get('2026-10-05')!;
    const b = indexSidesByDay(new Map([['2026-10-05', mutated]]), 'vwap-side').get('2026-10-05')!;
    for (const i of [0, 1]) expect(b.get(T('2026-10-05', i))).toBe(a.get(T('2026-10-05', i)));
  });
});

describe('indexSidesByDay: day-change', () => {
  it('compares with the previous session close, across a month boundary, and has no reading on the first session', () => {
    const days = new Map([
      ['2026-09-30', [c('2026-09-30', 0, 100, 100, 100, 100), c('2026-09-30', 1, 100, 100, 100, 110)]],
      ['2026-10-01', [c('2026-10-01', 0, 105, 105, 105, 105), c('2026-10-01', 1, 105, 112, 105, 112)]],
    ]);
    const sides = indexSidesByDay(days, 'day-change');
    expect(sides.get('2026-09-30')!.get(T('2026-09-30', 0))).toBeNull();
    expect(sides.get('2026-10-01')!.get(T('2026-10-01', 0))).toBe(-1); // 105 is below yesterday's 110
    expect(sides.get('2026-10-01')!.get(T('2026-10-01', 1))).toBe(1);
  });
});

describe('indexAllows', () => {
  it('lets longs through only above and shorts only below; no information says no', () => {
    expect(indexAllows('up', 1)).toBe(true);
    expect(indexAllows('up', -1)).toBe(false);
    expect(indexAllows('down', -1)).toBe(true);
    expect(indexAllows('down', 1)).toBe(false);
    for (const s of [0, null, undefined] as IndexSide[]) { expect(indexAllows('up', s)).toBe(false); expect(indexAllows('down', s)).toBe(false); }
  });
});

describe('the filter inside the engine', () => {
  const DAY = '2026-10-07';
  const prior: PriorTotals = { sumPv: 100 * 1000, sumV: 1000, lastClose: 99, lastVwap: 100 };
  const candles = [c(DAY, 0, 99.4, 99.6, 99.3, 99.5), c(DAY, 1, 99.5, 102, 99.4, 101.5), c(DAY, 2, 101.6, 102, 101.2, 101.8), c(DAY, 3, 101.8, 102, 101.5, 101.9)]; // an up-cross at c1
  const input = (indexSides?: IndexSide[]) => ({ day: DAY, month: '2026-10', sessionOfMonth: 4, symbol: 'NSE:X-EQ', sector: 'IT', candles, prior, indexSides });
  const on = { ...DEFAULT_FILTERS, indexFilter: 'with' as const };

  it('trades the up-cross when the index is above its VWAP at that candle', () => {
    expect(simulateDay(input([1, 1, 1, 1]), { name: 'eod' }, on)).toHaveLength(1);
  });
  it('blocks it when the index is below, neutral or unknown at that candle', () => {
    expect(simulateDay(input([1, -1, 1, 1]), { name: 'eod' }, on)).toEqual([]);
    expect(simulateDay(input([1, 0, 1, 1]), { name: 'eod' }, on)).toEqual([]);
    expect(simulateDay(input([1, null, 1, 1]), { name: 'eod' }, on)).toEqual([]);
    expect(simulateDay(input(undefined), { name: 'eod' }, on)).toEqual([]);
  });
  it('only the index at the signal candle matters, not a later one (no look-ahead)', () => {
    expect(simulateDay(input([0, 1, -1, -1]), { name: 'eod' }, on)).toHaveLength(1);
  });
  it('does nothing when the filter is off, whatever the index says', () => {
    expect(simulateDay(input([-1, -1, -1, -1]), { name: 'eod' }, DEFAULT_FILTERS)).toHaveLength(1);
  });
});

describe('the filter in a full run', () => {
  const shaped = (day: string, closeOfSignal: number): C5[] => Array.from({ length: 75 }, (_, i) => (i < 10 ? c(day, i, 100, 100, 100, 100) : i === 10 ? c(day, i, 100, Math.max(101.2, closeOfSignal), Math.min(100, closeOfSignal), closeOfSignal) : c(day, i, closeOfSignal, closeOfSignal, closeOfSignal, closeOfSignal)));
  const entry = { ticker: 'TCS', symbol: 'NSE:TCS-EQ', name: 'TCS', sector: 'IT' };
  const index = { ticker: 'NIFTY', symbol: 'NSE:NIFTY50-INDEX', name: 'NIFTY', sector: 'Index' };
  const months = ['2026-08-03', '2026-09-01', '2026-10-01'];
  const stock = months.map((d) => ({ entry, month: d.slice(0, 7), days: new Map([[d, shaped(d, 101)]]) }));
  const master: SymbolMaster = { lots: new Map([['TCS', 100]]), strikes: new Map(), expiry: new Map() };
  const cfg = (over: Record<string, unknown> = {}) => parseConfig({ universe: 'custom:TCS', from: '2026-08-01', to: '2026-10-09', slippageBps: 0, randomRuns: 10, bootstrapIterations: 100, exits: [{ name: 'hold', squareoffAt: '15:15' }], filters: { indexFilter: 'with' }, ...over });

  it('trades every month when the index rises with the stock, and none when the index falls', () => {
    const up = months.map((d) => ({ entry: index, month: d.slice(0, 7), days: new Map([[d, shaped(d, 101)]]) }));
    const down = months.map((d) => ({ entry: index, month: d.slice(0, 7), days: new Map([[d, shaped(d, 99)]]) }));
    expect(runBacktest(cfg(), stock, [], master, new Date(0), up).result.strategies[0].all.trades).toBe(3);
    expect(runBacktest(cfg(), stock, [], master, new Date(0), down).result.strategies[0].all.trades).toBe(0);
  });

  it('with no index data every trade is blocked, and the report says so', () => {
    const out = runBacktest(cfg(), stock, [], master, new Date(0), []);
    expect(out.result.strategies[0].all.trades).toBe(0);
    expect(out.result.warnings.join(' ')).toMatch(/Index filter on \(NSE:NIFTY50-INDEX, vwap-side\).*0 of 3 sessions/);
  });

  it('the filter off ignores the index entirely', () => {
    const out = runBacktest(cfg({ filters: { indexFilter: 'off' } }), stock, [], master, new Date(0), []);
    expect(out.result.strategies[0].all.trades).toBe(3);
  });

  it('rejects a bad filter setting', () => {
    expect(() => parseConfig({ filters: { indexFilter: 'sometimes' } })).toThrow(/indexFilter/);
    expect(() => parseConfig({ filters: { indexMode: 'moon' } })).toThrow(/indexMode/);
    expect(() => parseConfig({ filters: { indexSymbol: 'TCS' } })).toThrow(/indexSymbol/);
  });
});

describe('loadIndexHistory report', () => {
  const day = (d: string, v: number): C5[] => Array.from({ length: 75 }, (_, i) => c(d, i, 100, 101, 99, 100, v));
  const providerOf = (candles: Record<string, C5[]>): DataProvider => ({ name: 'fake', candles5m: async (symbol, from, to) => ({ ok: true as const, value: (candles[symbol] ?? []).filter((x) => { const d = new Date((x.t + 19800) * 1000).toISOString().slice(0, 10); return d >= from && d <= to; }) }) });

  it('says a symbol with volume can have a VWAP and one without cannot', async () => {
    const provider = providerOf({ 'NSE:NIFTY50-INDEX': [...day('2026-10-01', 0), ...day('2026-10-05', 0)], 'NSE:NIFTY26OCTFUT': [...day('2026-10-01', 500), ...day('2026-10-05', 500)] });
    const { reports } = await loadIndexHistory({ provider, symbols: ['NSE:NIFTY50-INDEX', 'NSE:NIFTY26OCTFUT'], from: '2026-10-01', to: '2026-10-09' });
    const [index, future] = reports;
    expect(index).toMatchObject({ ok: true, sessions: 2, candles: 150, vwapUsable: false, sessionsWithVolume: 0, zeroVolumeCandles: 150 });
    expect(index.note).toMatch(/no volume/);
    expect(future).toMatchObject({ ok: true, vwapUsable: true, sessionsWithVolume: 2, monthsUsable: ['2026-10'] });
    expect(future.sampleCandle?.v).toBe(500);
    expect(future.note).toMatch(/Continuous future/);
  });

  it('reports a symbol FYERS has nothing for, and stops on an expired login', async () => {
    const { reports } = await loadIndexHistory({ provider: providerOf({}), symbols: ['NSE:NIFTY50-INDEX'], from: '2026-10-01', to: '2026-10-09' });
    expect(reports[0]).toMatchObject({ ok: false, candles: 0 });
    expect(reports[0].note).toMatch(/no usable candles/);
    const expired: DataProvider = { name: 'x', candles5m: async () => ({ ok: false, code: 'LOGIN_REQUIRED', message: 'expired' }) };
    expect((await loadIndexHistory({ provider: expired, symbols: ['NSE:NIFTY50-INDEX'], from: '2026-10-01', to: '2026-10-09' })).loginRequired).toBe(true);
  });
});
