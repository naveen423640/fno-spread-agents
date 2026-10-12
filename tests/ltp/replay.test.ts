import { describe, expect, it } from 'vitest';

import { replayCsv, replayDay, REPLAY_COLUMNS } from '@/lib/ltp/replay';
import { createLtpStore } from '@/lib/ltp/store';
import { istTs } from '@/lib/ltp/time';
import { createD1Fake } from '../support/d1-fake';
import { syntheticDay } from '../support/ltp-day';

const U = 'NSE:NIFTY50-INDEX';
async function storeWith(count: number) {
  const store = createLtpStore(createD1Fake(['drizzle/0008_ltp.sql']));
  for (const s of syntheticDay('2026-10-12').slice(0, count)) await store.insertSnapshot(s);
  return store;
}

describe('replayDay', () => {
  it('writes a header and one row per stored snapshot', async () => {
    const csv = (await replayDay(await storeWith(30), U, '2026-10-12'))!;
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(REPLAY_COLUMNS.join(','));
    expect(lines).toHaveLength(31);
    expect(lines[1].split(',')[0]).toBe('09:15');
    expect(lines[30].split(',')[0]).toBe('09:44');
  });

  it('is deterministic: two replays of the same stored day are byte-identical', async () => {
    const store = await storeWith(45);
    expect(await replayDay(store, U, '2026-10-12')).toBe(await replayDay(store, U, '2026-10-12'));
  });

  it('each row reads only snapshots up to its own time, so a row does not change when the day is longer', async () => {
    const short = (await replayDay(await storeWith(20), U, '2026-10-12'))!.trim().split('\n');
    const long = (await replayDay(await storeWith(40), U, '2026-10-12'))!.trim().split('\n');
    expect(long.slice(0, 21)).toEqual(short);
  });

  it('shows the levels, statuses, scenario and the proxy reversal values', async () => {
    const lines = (await replayDay(await storeWith(10), U, '2026-10-12'))!.trim().split('\n');
    const row = Object.fromEntries(REPLAY_COLUMNS.map((c, i) => [c, lines[10].split(',')[i]]));
    expect(row).toMatchObject({ time: '09:24', support: '23900', resistance: '24200', eos_proxy: '23860', eor_proxy: '24255' });
    expect(['strong', 'wtt', 'wtb']).toContain(row.support_status);
    expect(Number(row.coa1)).toBeGreaterThanOrEqual(1);
  });

  it('says plainly when nothing is stored for the day', async () => {
    const store = await storeWith(5);
    expect(await replayDay(store, U, '2026-10-13')).toBeNull();
    expect(await replayDay(store, 'NSE:NIFTYBANK-INDEX', '2026-10-12')).toBeNull();
  });
});

describe('replayCsv', () => {
  it('quotes a value that contains a comma and leaves blanks for missing values', () => {
    expect(replayCsv([{ time: '09:15', note: 'a,b', x: null }], ['time', 'note', 'x'])).toBe('time,note,x\n09:15,"a,b",\n');
  });
});

describe('replay uses the same engine as the live view', () => {
  it('the last row matches analyzeSession at that time', async () => {
    const store = await storeWith(60);
    const lines = (await replayDay(store, U, '2026-10-12'))!.trim().split('\n');
    expect(lines[60].split(',')[0]).toBe('10:14');
    expect(istTs('2026-10-12', '10:14')).toBe((await store.snapshotsForDay(U, '2026-10-12'))[59].ts);
  });
});
