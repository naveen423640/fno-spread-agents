import { describe, expect, it } from 'vitest';

import { analyzeSession } from '@/lib/ltp/analyze';
import { createLtpStore } from '@/lib/ltp/store';
import { istTs } from '@/lib/ltp/time';
import { makeChain } from '../support/ltp-chain';
import { syntheticDay } from '../support/ltp-day';
import { createD1Fake } from '../support/d1-fake';

const fresh = () => createLtpStore(createD1Fake(['drizzle/0008_ltp.sql']));
const at = (date: string, hhmm: string) => istTs(date, hhmm);

describe('snapshots', () => {
  it('inserting the same snapshot twice leaves one row per key, and reports how many rows were new', async () => {
    const store = fresh();
    const s = makeChain({ spot: 24037, step: 50, ts: at('2026-10-12', '09:15') });
    const first = await store.insertSnapshot(s);
    const second = await store.insertSnapshot(s);
    expect(first.inserted).toBe(s.rows.length);
    expect(second.inserted).toBe(0);
    expect(await store.countForDay(s.underlying, '2026-10-12')).toBe(1); // one snapshot, however many rows
  });

  it('a snapshot comes back exactly as it went in, including nulls, flags, spot, step and latency', async () => {
    const store = fresh();
    const s = { ...makeChain({ spot: 24037.5, step: 50, ts: at('2026-10-12', '10:00'), pe: { 24000: { oi: null, volume: null } } }), fetchLatencyMs: 143 };
    await store.insertSnapshot(s);
    const [back] = await store.snapshotsForDay(s.underlying, '2026-10-12');
    expect(back).toEqual(s);
    expect(back.rows.find((r) => r.strike === 24000 && r.side === 'PE')).toMatchObject({ oi: null, volume: null, flags: ['oi', 'volume'] });
  });

  it('keeps underlyings and trade dates apart and returns snapshots in time order', async () => {
    const store = fresh();
    const a2 = makeChain({ spot: 24037, step: 50, ts: at('2026-10-12', '09:16') });
    const a1 = makeChain({ spot: 24037, step: 50, ts: at('2026-10-12', '09:15') });
    const other = makeChain({ spot: 55100, step: 100, ts: at('2026-10-12', '09:15'), underlying: 'NSE:NIFTYBANK-INDEX', expiry: '2026-10-27' });
    const nextDay = makeChain({ spot: 24037, step: 50, ts: at('2026-10-13', '09:15') });
    for (const s of [a2, other, nextDay, a1]) await store.insertSnapshot(s);
    const day = await store.snapshotsForDay('NSE:NIFTY50-INDEX', '2026-10-12');
    expect(day.map((s) => s.ts)).toEqual([a1.ts, a2.ts]);
    expect(await store.snapshotsForDay('NSE:NIFTYBANK-INDEX', '2026-10-12')).toHaveLength(1);
    expect(await store.snapshotsForDay('NSE:NIFTY50-INDEX', '2026-10-13')).toHaveLength(1);
    expect(await store.snapshotsForDay('NSE:NIFTY50-INDEX', '2026-10-14')).toEqual([]);
  });

  it('stores a full 41-strike chain (82 rows) despite the 100 bound-value limit per statement', async () => {
    const store = fresh();
    const strikes = Array.from({ length: 41 }, (_, i) => 23000 + i * 50);
    const s = makeChain({ spot: 24037, step: 50, strikes, ts: at('2026-10-12', '09:15') });
    expect((await store.insertSnapshot(s)).inserted).toBe(82);
    expect((await store.snapshotsForDay(s.underlying, '2026-10-12'))[0].rows).toHaveLength(82);
  });

  it('knows the latest snapshot, its time, and the latest trade date', async () => {
    const store = fresh();
    expect(await store.latest('NSE:NIFTY50-INDEX')).toBeNull();
    await store.insertSnapshot(makeChain({ spot: 24037, step: 50, ts: at('2026-10-09', '15:30') }));
    await store.insertSnapshot(makeChain({ spot: 24100, step: 50, ts: at('2026-10-12', '09:15') }));
    expect((await store.latest('NSE:NIFTY50-INDEX'))!.spot).toBe(24100);
    expect(await store.lastSnapshotTs('NSE:NIFTY50-INDEX')).toBe(at('2026-10-12', '09:15'));
    expect(await store.latestDate('NSE:NIFTY50-INDEX')).toBe('2026-10-12');
    expect(await store.latestDate('NSE:NIFTYBANK-INDEX')).toBeNull();
  });

  it('a stored day runs through the engine and gives the same result as the in-memory day (replay)', async () => {
    const store = fresh();
    const day = syntheticDay('2026-10-12').slice(0, 60);
    for (const s of day) await store.insertSnapshot(s);
    const back = await store.snapshotsForDay('NSE:NIFTY50-INDEX', '2026-10-12');
    const now = day[59].ts;
    expect(JSON.stringify(analyzeSession(back, { now }))).toBe(JSON.stringify(analyzeSession(day, { now })));
  });
});

describe('gaps, frozen lines, weekly ranges and calibration', () => {
  it('records a gap once per underlying and minute, with its reason', async () => {
    const store = fresh();
    const m = at('2026-10-12', '10:01');
    await store.addGap({ underlying: 'NSE:NIFTY50-INDEX', minuteTs: m, reason: 'upstream', detail: 'FYERS returned 500' });
    await store.addGap({ underlying: 'NSE:NIFTY50-INDEX', minuteTs: m, reason: 'upstream', detail: 'FYERS returned 500' });
    await store.addGap({ underlying: 'NSE:NIFTYBANK-INDEX', minuteTs: m, reason: 'login_required' });
    const gaps = await store.gapsForDay('2026-10-12');
    expect(gaps).toHaveLength(2);
    expect(gaps.find((g) => g.underlying === 'NSE:NIFTY50-INDEX')).toMatchObject({ minuteTs: m, reason: 'upstream', detail: 'FYERS returned 500' });
    expect(await store.gapsForDay('2026-10-13')).toEqual([]);
  });

  it('frozen 9:20 lines are written once: a second save for the same day and underlying is ignored', async () => {
    const store = fresh();
    await store.saveLines0920('2026-10-12', 'NSE:NIFTY50-INDEX', { eor: 1 });
    await store.saveLines0920('2026-10-12', 'NSE:NIFTY50-INDEX', { eor: 2 });
    expect(await store.getLines0920('2026-10-12', 'NSE:NIFTY50-INDEX')).toEqual({ eor: 1 });
    expect(await store.getLines0920('2026-10-12', 'NSE:NIFTYBANK-INDEX')).toBeNull();
  });

  it('weekly ranges are stored per week start and underlying, once', async () => {
    const store = fresh();
    await store.saveWeekly('2026-10-12', 'NSE:NIFTY50-INDEX', { s: 284.15 });
    await store.saveWeekly('2026-10-12', 'NSE:NIFTY50-INDEX', { s: 1 });
    expect(await store.getWeekly('2026-10-12', 'NSE:NIFTY50-INDEX')).toEqual({ s: 284.15 });
  });

  it('calibration entries are kept with the proxy values they were compared with', async () => {
    const store = fresh();
    await store.addCalibration({ id: 'a', underlying: 'NSE:NIFTY50-INDEX', entryTs: at('2026-10-12', '10:00'), label: 'EOS', actual: 23860, snapshotTs: at('2026-10-12', '10:00'), proxies: { writer_breakeven: 23862.5, time_value_only: 23850 } });
    const [e] = await store.calibrationEntries('NSE:NIFTY50-INDEX');
    expect(e).toMatchObject({ id: 'a', label: 'EOS', actual: 23860, proxies: { writer_breakeven: 23862.5, time_value_only: 23850 } });
    expect(await store.calibrationEntries('NSE:NIFTYBANK-INDEX')).toEqual([]);
  });
});
