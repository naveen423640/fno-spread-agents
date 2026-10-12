import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { health, isRecordingMinute, recordOnce, UNDERLYINGS, type ChainSource } from '@/lib/ltp/recorder';
import { createLtpStore } from '@/lib/ltp/store';
import { istTs } from '@/lib/ltp/time';
import { createD1Fake } from '../support/d1-fake';

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/ltp/${name}-chain.json`, 'utf8')) as Record<string, unknown>;
const BY_UNDERLYING: Record<string, string> = { 'NSE:NIFTY50-INDEX': 'nifty', 'NSE:NIFTYBANK-INDEX': 'banknifty', 'BSE:SENSEX-INDEX': 'sensex' };
const DAY = '2026-10-12'; // a Monday, not a listed holiday
const none = new Set<string>();

// A fake FYERS: answers each underlying with its real fixture unless told to fail; counts calls per underlying.
function fake(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const source: ChainSource = { async optionChain(underlying) {
    calls.push(underlying);
    const o = over[underlying];
    if (o !== undefined) return o as never;
    return { ok: true, value: fixture(BY_UNDERLYING[underlying]) } as never;
  } };
  return { source, calls };
}
// A clock that moves forward 150 ms each time it is read, so the measured latency is 150.
const ticking = (start: number) => { let t = start; return () => { const d = new Date(t); t += 150; return d; }; };
const fresh = () => createLtpStore(createD1Fake(['drizzle/0008_ltp.sql']));
const deps = (store: ReturnType<typeof fresh>, source: ChainSource, now: () => Date, extra = {}) => ({ adapter: source, store, now, underlyings: UNDERLYINGS, strikecount: 20, holidays: none, ...extra });

describe('isRecordingMinute', () => {
  it('records from 09:15:00 to 15:30:00 IST inclusive on a trading day', () => {
    expect(isRecordingMinute(istTs(DAY, '09:15', 0), none)).toBe(true);
    expect(isRecordingMinute(istTs(DAY, '15:30', 0), none)).toBe(true);
    expect(isRecordingMinute(istTs(DAY, '09:14', 59), none)).toBe(false);
    expect(isRecordingMinute(istTs(DAY, '15:30', 1), none)).toBe(false);
  });
  it('skips weekends and listed holidays', () => {
    expect(isRecordingMinute(istTs('2026-10-10', '10:00', 0), none)).toBe(false); // Saturday
    expect(isRecordingMinute(istTs('2026-10-11', '10:00', 0), none)).toBe(false); // Sunday
    expect(isRecordingMinute(istTs(DAY, '10:00', 0), new Set([DAY]))).toBe(false);
  });
});

describe('recordOnce', () => {
  it('stores one snapshot per underlying, stamped with the minute it belongs to, with the measured latency', async () => {
    const store = fresh();
    const { source } = fake();
    const now = ticking(istTs(DAY, '10:00', 20) * 1000);
    const r = await recordOnce(deps(store, source, now));
    expect(r.skipped).toBeUndefined();
    expect(r.minuteTs).toBe(istTs(DAY, '10:00', 0));
    expect(r.results.map((x) => [x.underlying, x.inserted, x.gap])).toEqual([['NSE:NIFTY50-INDEX', 5, undefined], ['NSE:NIFTYBANK-INDEX', 5, undefined], ['BSE:SENSEX-INDEX', 5, undefined]]);
    const [snap] = await store.snapshotsForDay('NSE:NIFTY50-INDEX', DAY);
    expect(snap).toMatchObject({ ts: istTs(DAY, '10:00', 0), expiry: '2026-10-13', step: 50, spot: 22583.15, fetchLatencyMs: 150 });
    expect(await store.countForDay('BSE:SENSEX-INDEX', DAY)).toBe(1);
  });

  it('running the same minute twice creates no duplicates and does not call FYERS again', async () => {
    const store = fresh();
    const { source, calls } = fake();
    await recordOnce(deps(store, source, ticking(istTs(DAY, '10:00', 5) * 1000)));
    const second = await recordOnce(deps(store, source, ticking(istTs(DAY, '10:00', 40) * 1000)));
    expect(calls).toHaveLength(3); // one call per underlying, from the first run only
    expect(second.results.every((x) => x.skipped === 'already_recorded' && x.inserted === 0)).toBe(true);
    expect(await store.countForDay('NSE:NIFTY50-INDEX', DAY)).toBe(1);
  });

  it('a failed fetch writes a gap row with its reason and no snapshot, and the other underlyings still record', async () => {
    const store = fresh();
    const { source } = fake({ 'NSE:NIFTYBANK-INDEX': { ok: false, code: 'UPSTREAM', message: 'FYERS returned 500' } });
    const r = await recordOnce(deps(store, source, ticking(istTs(DAY, '10:01', 10) * 1000)));
    expect(r.results.find((x) => x.underlying === 'NSE:NIFTYBANK-INDEX')).toMatchObject({ inserted: 0, gap: 'upstream' });
    expect(await store.countForDay('NSE:NIFTYBANK-INDEX', DAY)).toBe(0); // no fake or stale data
    expect(await store.snapshotsForDay('NSE:NIFTYBANK-INDEX', DAY)).toEqual([]);
    expect(await store.countForDay('NSE:NIFTY50-INDEX', DAY)).toBe(1);
    expect(await store.gapsForDay(DAY)).toEqual([{ underlying: 'NSE:NIFTYBANK-INDEX', minuteTs: istTs(DAY, '10:01', 0), reason: 'upstream', detail: 'FYERS returned 500' }]);
  });

  it('an expired login is a gap with reason login_required for each underlying', async () => {
    const store = fresh();
    const failing = { ok: false, code: 'LOGIN_REQUIRED', message: 'The broker login has expired. Sign in again.' };
    const { source } = fake(Object.fromEntries(UNDERLYINGS.map((u) => [u, failing])));
    await recordOnce(deps(store, source, ticking(istTs(DAY, '10:02', 0) * 1000)));
    expect((await store.gapsForDay(DAY)).map((g) => g.reason)).toEqual(['login_required', 'login_required', 'login_required']);
  });

  it('a response that cannot be read as a chain is a gap, not data', async () => {
    const store = fresh();
    const { source } = fake({ 'BSE:SENSEX-INDEX': { ok: true, value: { s: 'ok', data: { optionsChain: [], expiryData: [] } } } });
    const r = await recordOnce(deps(store, source, ticking(istTs(DAY, '10:03', 0) * 1000)));
    expect(r.results.find((x) => x.underlying === 'BSE:SENSEX-INDEX')?.gap).toBe('empty');
    expect(await store.countForDay('BSE:SENSEX-INDEX', DAY)).toBe(0);
  });

  it('does nothing outside the recording window or on a holiday, and writes no gap for it', async () => {
    const store = fresh();
    const { source, calls } = fake();
    const early = await recordOnce(deps(store, source, ticking(istTs(DAY, '09:14', 59) * 1000)));
    expect(early.skipped).toBe('not_recording_minute');
    const holiday = await recordOnce(deps(store, source, ticking(istTs(DAY, '10:00', 0) * 1000), { holidays: new Set([DAY]) }));
    expect(holiday.skipped).toBe('not_recording_minute');
    expect(calls).toEqual([]);
    expect(await store.gapsForDay(DAY)).toEqual([]);
  });

  it('records the 15:30 snapshot even when the run starts a few seconds into that minute, but not the next minute', async () => {
    const store = fresh();
    const { source } = fake();
    expect((await recordOnce(deps(store, source, ticking(istTs(DAY, '15:30', 3) * 1000)))).minuteTs).toBe(istTs(DAY, '15:30', 0));
    expect((await recordOnce(deps(store, source, ticking(istTs(DAY, '15:31', 0) * 1000)))).skipped).toBe('not_recording_minute');
    expect(await store.countForDay('NSE:NIFTY50-INDEX', DAY)).toBe(1);
  });

  it('force records outside the window for a test run, but a failure then writes no gap (it is not a missed minute)', async () => {
    const store = fresh();
    const ok = fake();
    const sat = ticking(istTs('2026-10-10', '11:00', 0) * 1000);
    expect((await recordOnce(deps(store, ok.source, sat, { force: true }))).results.every((x) => x.inserted === 5)).toBe(true);
    const bad = fake({ 'NSE:NIFTY50-INDEX': { ok: false, code: 'UPSTREAM', message: 'x' } });
    await recordOnce(deps(store, bad.source, ticking(istTs('2026-10-10', '11:05', 0) * 1000), { force: true }));
    expect(await store.gapsForDay('2026-10-10')).toEqual([]);
  });
});

describe('health', () => {
  const record = async (store: ReturnType<typeof fresh>, hhmm: string, sec: number) => recordOnce(deps(store, fake().source, ticking(istTs(DAY, hhmm, sec) * 1000)));

  it('is green under 2 minutes after the last snapshot, amber under 5, red otherwise', async () => {
    const store = fresh();
    await record(store, '10:00', 5);
    const last = istTs(DAY, '10:00', 0);
    expect((await health(store, last + 90, UNDERLYINGS)).badge).toBe('green');
    expect((await health(store, last + 4 * 60, UNDERLYINGS)).badge).toBe('amber');
    expect((await health(store, last + 6 * 60, UNDERLYINGS)).badge).toBe('red');
  });

  it('reports the last success, today\'s count per underlying and the gap count', async () => {
    const store = fresh();
    await record(store, '10:00', 5);
    await record(store, '10:01', 5);
    await recordOnce(deps(store, fake({ 'NSE:NIFTY50-INDEX': { ok: false, code: 'UPSTREAM', message: 'x' } }).source, ticking(istTs(DAY, '10:02', 5) * 1000)));
    const h = await health(store, istTs(DAY, '10:02', 30), UNDERLYINGS);
    expect(h.lastSuccessTs).toBe(istTs(DAY, '10:02', 0)); // the other two underlyings still recorded at 10:02
    expect(h.snapshotsToday).toEqual({ 'NSE:NIFTY50-INDEX': 2, 'NSE:NIFTYBANK-INDEX': 3, 'BSE:SENSEX-INDEX': 3 });
    expect(h.gapsToday).toBe(1);
  });

  it('is red with no last success before anything has been recorded', async () => {
    const h = await health(fresh(), istTs(DAY, '10:00', 0), UNDERLYINGS);
    expect(h).toMatchObject({ badge: 'red', lastSuccessTs: null, gapsToday: 0 });
  });
});
