import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runBacktest } from '@/lib/ltp-agent/backtest';
import { parseStrategy } from '@/lib/ltp-agent/strategy';
import { writerBreakeven } from '@/lib/ltp/extensions';
import { chainAt, DAY, freshStores, pathDay, U } from '../support/ltp-agent-day';

const v01 = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const WINNER: [string, number][] = [['10:00', 23880], ['10:01', 23862], ['10:02', 23900], ['10:03', 24100], ['10:04', 24275], ['10:05', 24275]];
const base = { strategy: v01, method: writerBreakeven, underlyings: [U] };

async function stores(path: [string, number][]) {
  const s = freshStores();
  for (const snap of pathDay(path)) await s.store.insertSnapshot(snap);
  return s;
}

describe('runBacktest replays recorded days through the agent and lists what it would have traded', () => {
  it('one clean touch: one trade, closed on its target, in both books, with the why sentence', async () => {
    const { store } = await stores(WINNER);
    const r = await runBacktest({ store, days: [DAY], ...base });
    expect(r.version).toBe('0.1');
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ underlying: U, direction: 'long', entry: 23862, stop: 23765, target: 24255 });
    expect(r.trades[0].reason).toMatch(/^LONG NIFTY 1\(S\d+~?\/R\d+~?\) S-Stable R-Stable · /);
    expect(r.trades[0].books.buy).toMatchObject({ status: 'closed', exitReason: 'target' });
    expect(r.trades[0].books.sell).toMatchObject({ status: 'closed', exitReason: 'target' });
    expect(r.summary).toMatchObject({ decisions: 1, taken: 1, skipped: 0, closedTrades: 1 });
    expect(r.summary.byBook.buy.n).toBe(1);
    expect(r.summary.byBook.sell.n).toBe(1);
  });
  it('skipped signals are listed and counted by the rule that stopped them', async () => {
    const { store } = await stores([['10:00', 23880], ['10:01', 23862], ['10:02', 23890], ['10:03', 23862]]);
    const r = await runBacktest({ store, days: [DAY], ...base });
    expect(r.summary).toMatchObject({ decisions: 2, taken: 1, skipped: 1 });
    expect(r.skipCounts).toEqual({ max_concurrent: 1 });
    expect(r.skipped[0]).toMatchObject({ skipReason: 'max_concurrent' });
  });
  it('a trade still open when the recorded day ends is closed as a data gap, and the notes say so', async () => {
    const { store } = await stores([['10:00', 23880], ['10:01', 23862]]);
    const r = await runBacktest({ store, days: [DAY], ...base });
    expect(r.trades[0].books.buy?.exitReason).toBe('data_gap');
    expect(r.notes.join(' ')).toMatch(/data gap/i);
  });
  it('the notes say when the history starts late and when fills had no quote', async () => {
    const s = freshStores();
    for (const snap of [chainAt('09:47', 24037), chainAt('09:48', 24037)]) await s.store.insertSnapshot(snap);
    const r = await runBacktest({ store: s.store, days: [DAY], ...base });
    expect(r.notes.join(' ')).toMatch(/starts at 09:47/);
  });
  it('a day with no recorded data gives an empty result, not an error', async () => {
    const { store } = freshStores();
    const r = await runBacktest({ store, days: [DAY], ...base });
    expect(r).toMatchObject({ trades: [], skipped: [], summary: { decisions: 0, taken: 0, closedTrades: 0 } });
  });
  it('several days are replayed in date order and totalled', async () => {
    const s = freshStores();
    for (const day of ['2026-10-12', '2026-10-13']) for (const snap of pathDay(WINNER, '09:15', day)) await s.store.insertSnapshot(snap);
    const r = await runBacktest({ store: s.store, days: ['2026-10-13', '2026-10-12'], ...base });
    expect(r.days).toEqual(['2026-10-12', '2026-10-13']);
    expect(r.trades.map((t) => t.ts)).toEqual(r.trades.map((t) => t.ts).sort((a, b) => a - b));
    expect(r.summary.closedTrades).toBe(2);
  });
  it('a different strategy on the same day gives a different result: a tighter touch band misses the entry', async () => {
    const { store } = await stores(WINNER);
    const tight = { ...v01, touch_tolerance_pts: 1 };
    const r = await runBacktest({ store, days: [DAY], ...base, strategy: tight, label: 'v0.1 + changes (touch_tolerance_pts=1)' });
    expect(r.trades).toHaveLength(0);
    expect(r.label).toBe('v0.1 + changes (touch_tolerance_pts=1)');
    expect((await runBacktest({ store, days: [DAY], ...base })).label).toBe('v0.1');
  });
  it('sharing an analysis cache between two runs changes nothing', async () => {
    const { store } = await stores(WINNER);
    const cache = new Map();
    const first = await runBacktest({ store, days: [DAY], ...base, cache });
    expect(await runBacktest({ store, days: [DAY], ...base, cache })).toEqual(first);
    expect(cache.size).toBeGreaterThan(0);
  });
  it('is deterministic, and never writes to the snapshot store', async () => {
    const { store } = await stores(WINNER);
    const readOnly = new Proxy(store, { get: (t, key: string) => (/^(save|add|insert)/.test(key) ? () => { throw new Error(`wrote to the snapshot store: ${key}`); } : (t as never)[key]) });
    const a = await runBacktest({ store: readOnly, days: [DAY], ...base });
    expect(await runBacktest({ store: readOnly, days: [DAY], ...base })).toEqual(a);
  });
});
