import { describe, expect, it } from 'vitest';

import { importExport } from '../../cloud-recorder/src/import';
import { createLtpStore } from '@/lib/ltp/store';
import { createD1Fake } from '../support/d1-fake';

const MIGRATIONS = ['drizzle/0008_ltp.sql', 'drizzle/0009_ltp_bidask.sql'];
const U = 'NSE:NIFTY50-INDEX';
const row = (snapshot_ts: number, strike: number, side: 'CE' | 'PE', ltp: number) => ({
  underlying: U, expiry: '2026-10-13', snapshot_ts, trade_date: '2026-10-12', strike, side, ltp, oi: 100, oi_change: 5, volume: 200, spot: 22450, step: 50, fetch_latency_ms: 120, flags: '', bid: ltp - 0.05, ask: ltp + 0.05, futures: 22480,
});
const body = { snapshots: [row(1000, 22400, 'CE', 80), row(1000, 22400, 'PE', 60), row(1060, 22400, 'CE', 82)], gaps: [{ underlying: U, minute_ts: 1120, trade_date: '2026-10-12', reason: 'upstream', detail: 'x' }] };

describe('importExport: pulling a day from the cloud recorder into the local database', () => {
  it('stores every row and gap, and the local store reads them back', async () => {
    const db = createD1Fake(MIGRATIONS);
    expect(await importExport(db, body)).toEqual({ snapshots: 3, gaps: 1 });
    const latest = await createLtpStore(db).latest(U);
    expect(latest).toMatchObject({ ts: 1060, spot: 22450, futures: 22480 });
    expect((await createLtpStore(db).gapsForDay('2026-10-12')).map((g) => g.reason)).toEqual(['upstream']);
  });
  it('importing the same day again adds nothing, and a row already here is kept as it is', async () => {
    const db = createD1Fake(MIGRATIONS);
    await db.prepare('INSERT INTO ltp_snapshots (underlying, expiry, snapshot_ts, trade_date, strike, side, ltp, oi, oi_change, volume, spot, step, fetch_latency_ms, flags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(U, '2026-10-13', 1000, '2026-10-12', 22400, 'CE', 99, 1, 1, 1, 22450, 50, 1, '').run();
    await importExport(db, body);
    await importExport(db, body);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM ltp_snapshots').first<{ n: number }>();
    expect(count?.n).toBe(3);
    const kept = await db.prepare('SELECT ltp FROM ltp_snapshots WHERE snapshot_ts = 1000 AND strike = 22400 AND side = ?').bind('CE').first<{ ltp: number }>();
    expect(kept?.ltp).toBe(99);
  });
  it('refuses a body that is not an export, and a row with a missing key column', async () => {
    const db = createD1Fake(MIGRATIONS);
    await expect(importExport(db, { nope: true } as never)).rejects.toThrow(/not an export/i);
    await expect(importExport(db, { snapshots: [{ underlying: U }], gaps: [] } as never)).rejects.toThrow(/row 1/i);
  });
});
