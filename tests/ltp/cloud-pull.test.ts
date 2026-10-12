import { describe, expect, it } from 'vitest';

import { pullFromCloud } from '@/lib/ltp/cloud-pull';
import { UNDERLYINGS } from '@/lib/ltp/recorder';
import { createLtpStore } from '@/lib/ltp/store';
import { createD1Fake } from '../support/d1-fake';

const URL_BASE = 'https://ltp-recorder.example.workers.dev';
const SECRET = 'admin-secret-123';
const MIGRATIONS = ['drizzle/0008_ltp.sql', 'drizzle/0009_ltp_bidask.sql'];
const row = (underlying: string, date: string, snapshot_ts: number) => ({ underlying, expiry: '2026-10-13', snapshot_ts, trade_date: date, strike: 22400, side: 'CE', ltp: 80, oi: 100, oi_change: 5, volume: 200, spot: 22450, step: 50, fetch_latency_ms: 120, flags: '', bid: null, ask: null, futures: null });

// A fake recorder: every underlying has one row on each date it is asked for, and the last underlying has a gap too.
function recorder(status = 200) {
  const asked: string[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    asked.push(`${url.searchParams.get('date')}|${url.searchParams.get('underlying')}|${((init?.headers ?? {}) as Record<string, string>).Authorization}`);
    if (status !== 200) return new Response('{}', { status });
    const date = url.searchParams.get('date')!;
    const underlying = url.searchParams.get('underlying')!;
    return Response.json({ snapshots: [row(underlying, date, Math.floor(Date.parse(`${date}T04:30:00Z`) / 1000))], gaps: underlying === UNDERLYINGS[2] ? [{ underlying, minute_ts: 1060, trade_date: date, reason: 'upstream', detail: '' }] : [] });
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}

describe('pullFromCloud: merging the cloud recorder\'s days into the local database', () => {
  it('asks for each date and each index with the secret, and stores what comes back', async () => {
    const db = createD1Fake(MIGRATIONS);
    const { asked, fetchImpl } = recorder();
    const result = await pullFromCloud({ db, url: `${URL_BASE}/`, secret: SECRET, dates: ['2026-10-11', '2026-10-12'], fetchImpl });
    expect(result).toEqual({ ok: true, snapshots: 6, gaps: 2 });
    expect(asked).toHaveLength(6);
    expect(asked[0]).toBe(`2026-10-11|${UNDERLYINGS[0]}|Bearer ${SECRET}`);
    expect(await createLtpStore(db).recordedDays()).toEqual(['2026-10-11', '2026-10-12']);
  });
  it('pulling again adds nothing', async () => {
    const db = createD1Fake(MIGRATIONS);
    const { fetchImpl } = recorder();
    await pullFromCloud({ db, url: URL_BASE, secret: SECRET, dates: ['2026-10-12'], fetchImpl });
    await pullFromCloud({ db, url: URL_BASE, secret: SECRET, dates: ['2026-10-12'], fetchImpl });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM ltp_snapshots').first<{ n: number }>())?.n).toBe(3);
  });
  it('without the recorder address or secret it says what to set and calls nothing', async () => {
    const { asked, fetchImpl } = recorder();
    for (const over of [{ url: undefined }, { secret: undefined }]) {
      expect(await pullFromCloud({ db: createD1Fake(MIGRATIONS), url: URL_BASE, secret: SECRET, dates: ['2026-10-12'], fetchImpl, ...over })).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/LTP_RECORDER_URL.*LTP_RECORDER_SECRET/) });
    }
    expect(asked).toHaveLength(0);
  });
  it('a refusal or an unreachable recorder is reported plainly, never with the secret', async () => {
    const wrong = await pullFromCloud({ db: createD1Fake(MIGRATIONS), url: URL_BASE, secret: SECRET, dates: ['2026-10-12'], fetchImpl: recorder(401).fetchImpl });
    expect(wrong).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/401.*secret/i) });
    const down = await pullFromCloud({ db: createD1Fake(MIGRATIONS), url: URL_BASE, secret: SECRET, dates: ['2026-10-12'], fetchImpl: (async () => { throw new Error(`failed ${SECRET}`); }) as unknown as typeof fetch });
    expect(down).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(down)).not.toContain(SECRET);
  });
});
