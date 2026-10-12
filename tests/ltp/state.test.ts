import { describe, expect, it } from 'vitest';

import type { UsableAnalysis } from '@/lib/ltp/analyze';
import { buildState, type LtpState } from '@/lib/ltp/state';
import { createLtpStore } from '@/lib/ltp/store';
import { istTs } from '@/lib/ltp/time';
import { makeChain } from '../support/ltp-chain';
import { syntheticDay } from '../support/ltp-day';
import { createD1Fake } from '../support/d1-fake';

const U = 'NSE:NIFTY50-INDEX';
const DAY = '2026-10-12';
const none = new Set<string>();
const fresh = () => createLtpStore(createD1Fake(['drizzle/0008_ltp.sql']));
function usable(r: LtpState): UsableAnalysis {
  if (r.empty || r.analysis.empty || !r.analysis.usable) throw new Error('expected usable levels');
  return r.analysis;
}
async function seeded(count: number, date = DAY) {
  const store = fresh();
  for (const s of syntheticDay(date).slice(0, count)) await store.insertSnapshot(s);
  return store;
}

describe('buildState', () => {
  it('before any snapshot: an explicit empty state, a red badge, and no crash', async () => {
    const r = await buildState(fresh(), { underlying: U, nowTs: istTs(DAY, '09:10'), holidays: none });
    expect(r).toMatchObject({ empty: true, reason: 'no_data_yet', underlying: U });
    expect(r.health.badge).toBe('red');
  });

  it('shows the live day: levels, scenario, extensions, the chain around the imaginary line and the health badge', async () => {
    const store = await seeded(61); // 09:15 to 10:15
    const r = await buildState(store, { underlying: U, nowTs: istTs(DAY, '10:15', 20), holidays: none, method: 'writer_breakeven' });
    if (r.empty) throw new Error('expected data');
    expect(r).toMatchObject({ date: DAY, viewingStoredDay: false, snapshotTs: istTs(DAY, '10:15') });
    expect(r.health.badge).toBe('green');
    const a = usable(r);
    expect(a.levels.support.strike).toBe(23900);
    expect(a.coa1.scenario.number).toBeGreaterThanOrEqual(1);
    const strikes = r.chain.map((c) => c.strike);
    expect(strikes).toEqual([...strikes].sort((a, b) => a - b));
    expect(strikes).toContain(24000);
    expect(r.chain.filter((c) => c.mark !== null).map((c) => [c.strike, c.mark])).toEqual([[24000, 'line_low'], [24050, 'line_high']]);
    const row = r.chain.find((c) => c.strike === 23900)!;
    expect(row.putReversal).toBe(23860); // proxy: 23900 less the put LTP of 40
    expect(row.pe?.oi).toBeGreaterThan(0);
    expect(r.methods.map((m) => m.id)).toEqual(['iv_move', 'writer_breakeven', 'time_value_only']);
  });

  it('outside market hours it renders the last stored day, as stored', async () => {
    const store = await seeded(61);
    const sunday = await buildState(store, { underlying: U, nowTs: istTs('2026-10-18', '11:00'), holidays: none });
    if (sunday.empty) throw new Error('expected data');
    expect(sunday).toMatchObject({ date: DAY, viewingStoredDay: true, snapshotTs: istTs(DAY, '10:15') });
    expect(sunday.health.badge).toBe('red'); // the recorder has not produced a snapshot for days
  });

  it('a stale recorder turns the badge amber, then red', async () => {
    const store = await seeded(61);
    const last = istTs(DAY, '10:15');
    expect((await buildState(store, { underlying: U, nowTs: last + 4 * 60, holidays: none })).health.badge).toBe('amber');
    expect((await buildState(store, { underlying: U, nowTs: last + 6 * 60, holidays: none })).health.badge).toBe('red');
  });

  it('a date with no snapshots is an explicit empty state for that date', async () => {
    const r = await buildState(await seeded(10), { underlying: U, date: '2026-10-09', nowTs: istTs(DAY, '10:00'), holidays: none });
    expect(r).toMatchObject({ empty: true, reason: 'no_data_for_date' });
  });

  it('the 9:20 lines are saved the first time they exist and never change afterwards', async () => {
    const store = await seeded(10); // 09:15 to 09:24
    const first = await buildState(store, { underlying: U, nowTs: istTs(DAY, '09:24', 20), holidays: none });
    if (first.empty) throw new Error('expected data');
    expect(first.lines0920?.eos.method).toBe('iv_move');
    expect(await store.getLines0920(DAY, U)).not.toBeNull();
    // A different chain stored later must not change the frozen lines.
    for (let m = 25; m < 40; m += 1) await store.insertSnapshot(makeChain({ spot: 24037, step: 50, ts: istTs(DAY, `09:${m}`), pe: { 23900: { volume: 9000, oi: 9000, ltp: 1 } }, ce: { 24200: { volume: 9000, oi: 9000, ltp: 1 } } }));
    const later = await buildState(store, { underlying: U, nowTs: istTs(DAY, '09:40', 20), holidays: none });
    if (later.empty) throw new Error('expected data');
    expect(later.lines0920).toEqual(first.lines0920);
  });

  it('before 09:20 there are no lines yet', async () => {
    const r = await buildState(await seeded(3), { underlying: U, nowTs: istTs(DAY, '09:18', 20), holidays: none });
    if (r.empty) throw new Error('expected data');
    expect(r.lines0920).toBeNull();
  });

  it('the weekly range uses the first stored day of the current expiry, is saved once, and flags a late start', async () => {
    const store = fresh();
    for (let m = 22; m < 26; m += 1) await store.insertSnapshot(makeChain({ spot: 24037, step: 50, ts: istTs('2026-10-09', `09:${m}`), pe: { 24000: { ltp: 121.05 } }, ce: { 24050: { ltp: 163.1 } } })); // first recorded day, but not from 09:15
    for (const s of syntheticDay(DAY).slice(0, 5)) await store.insertSnapshot(s);
    const r = await buildState(store, { underlying: U, nowTs: istTs(DAY, '09:19', 20), holidays: none });
    if (r.empty) throw new Error('expected data');
    expect(r.weeklyWeekStart).toBe('2026-10-09');
    expect(r.weekly).toMatchObject({ lateStart: true, s: 284.15 });
    expect(r.weekly?.l1[0]).toBeCloseTo(24037 - 284.15, 2);
    expect(await store.getWeekly('2026-10-09', U)).not.toBeNull();
  });

  it('takes the extension method as a parameter and ignores an unknown one', async () => {
    const store = await seeded(20);
    const tv = await buildState(store, { underlying: U, nowTs: istTs(DAY, '09:34'), method: 'time_value_only', holidays: none });
    expect(usable(tv).extensions.eos.method).toBe('time_value_only');
    const bogus = await buildState(store, { underlying: U, nowTs: istTs(DAY, '09:34'), method: 'nope', holidays: none });
    expect(usable(bogus).extensions.eos.method).toBe('iv_move');
  });

  it('a snapshot with no imaginary line gives an unusable analysis and an empty chain view, not an error', async () => {
    const store = fresh();
    await store.insertSnapshot(makeChain({ spot: 10, step: 50, strikes: [24000, 24050], ts: istTs(DAY, '10:00') }));
    const r = await buildState(store, { underlying: U, nowTs: istTs(DAY, '10:00', 20), holidays: none });
    if (r.empty) throw new Error('expected data');
    expect(r.analysis.empty === false && r.analysis.usable).toBe(false);
    expect(r.chain).toEqual([]);
  });
});
