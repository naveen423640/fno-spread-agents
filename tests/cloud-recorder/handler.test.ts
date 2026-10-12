import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { handleRequest, runScheduled, type Env } from '../../cloud-recorder/src/handler';
import { createLtpStore } from '@/lib/ltp/store';
import { UNDERLYINGS, type ChainSource } from '@/lib/ltp/recorder';
import { istTs } from '@/lib/ltp/time';
import { createD1Fake } from '../support/d1-fake';

const SECRET = 'correct-horse-battery';
const TOKEN = 'fyers-token-abc123';
const DAY = '2026-10-12'; // a Monday, not a listed holiday
const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/ltp/${name}-chain.json`, 'utf8')) as Record<string, unknown>;
const BY_UNDERLYING: Record<string, string> = { 'NSE:NIFTY50-INDEX': 'nifty', 'NSE:NIFTYBANK-INDEX': 'banknifty', 'BSE:SENSEX-INDEX': 'sensex' };

const freshDb = () => createD1Fake(['drizzle/0008_ltp.sql', 'drizzle/0009_ltp_bidask.sql', 'cloud-recorder/schema.sql']);
const envOf = (db = freshDb(), over: Partial<Env> = {}): Env => ({ DB: db, ADMIN_SECRET: SECRET, FYERS_CLIENT_ID: 'CLIENT-100', ...over });
const call = (env: Env, path: string, init: RequestInit & { secret?: string | null } = {}) => {
  const { secret = SECRET, ...rest } = init;
  return handleRequest(new Request(`https://recorder.example${path}`, { ...rest, headers: { ...(secret ? { authorization: `Bearer ${secret}` } : {}), 'content-type': 'application/json', ...(rest.headers as Record<string, string> | undefined) } }), env, new Date(istTs(DAY, '10:00', 20) * 1000));
};
const fakeSource = (seen: { token?: string; calls: string[] } = { calls: [] }) => (credentials: { clientId: string; accessToken: string }): ChainSource => ({
  async optionChain(underlying) { seen.token = credentials.accessToken; seen.calls.push(underlying); return { ok: true, value: fixture(BY_UNDERLYING[underlying]) } as never; },
});

describe('who may call the recorder', () => {
  it('every route refuses a missing or wrong secret, and answers 503 when no secret is configured', async () => {
    const env = envOf();
    for (const [method, path] of [['PUT', '/token'], ['GET', '/health'], ['GET', `/export?date=${DAY}&underlying=NSE:NIFTY50-INDEX`]] as const) {
      expect((await call(env, path, { method, secret: null })).status).toBe(401);
      expect((await call(env, path, { method, secret: 'wrong' })).status).toBe(401);
    }
    expect((await call(envOf(freshDb(), { ADMIN_SECRET: '' }), '/health')).status).toBe(503);
  });
  it('an unknown route is 404 once authorised', async () => { expect((await call(envOf(), '/nope')).status).toBe(404); });
});

describe('the daily token', () => {
  it('PUT /token stores it and /health says a token is present, with the time, never the token itself', async () => {
    const env = envOf();
    const put = await call(env, '/token', { method: 'PUT', body: JSON.stringify({ token: TOKEN }) });
    expect(put.status).toBe(200);
    expect(JSON.stringify(await put.json())).not.toContain(TOKEN);
    const health = await call(env, '/health');
    const text = JSON.stringify(await health.json());
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toMatchObject({ token: { present: true, savedAt: istTs(DAY, '10:00', 20) } });
  });
  it('a second PUT replaces the first', async () => {
    const db = freshDb();
    const env = envOf(db);
    await call(env, '/token', { method: 'PUT', body: JSON.stringify({ token: 'old' }) });
    await call(env, '/token', { method: 'PUT', body: JSON.stringify({ token: TOKEN }) });
    const row = await db.prepare('SELECT token FROM recorder_token').first<{ token: string }>();
    expect(row?.token).toBe(TOKEN);
  });
  it('rejects a body without a usable token', async () => {
    const env = envOf();
    for (const body of ['{}', '{"token":""}', '{"token":5}', 'not json', JSON.stringify({ token: 'x'.repeat(5000) })]) {
      expect((await call(env, '/token', { method: 'PUT', body })).status).toBe(400);
    }
  });
  it('health with no token says so', async () => {
    expect(await (await call(envOf(), '/health')).json()).toMatchObject({ token: { present: false, savedAt: null } });
  });
});

describe('the scheduled recording', () => {
  const at = (hhmm: string, sec = 20) => new Date(istTs(DAY, hhmm, sec) * 1000);

  it('records one snapshot per underlying with the stored token, and the same minute twice adds nothing', async () => {
    const db = freshDb();
    const env = envOf(db);
    await call(env, '/token', { method: 'PUT', body: JSON.stringify({ token: TOKEN }) });
    const seen = { calls: [] as string[] } as { token?: string; calls: string[] };
    const first = await runScheduled(env, at('10:00'), fakeSource(seen));
    expect(first.results.map((r) => r.inserted > 0)).toEqual([true, true, true]);
    expect(seen.token).toBe(TOKEN);
    const again = await runScheduled(env, at('10:00', 40), fakeSource(seen));
    expect(again.results.every((r) => r.skipped === 'already_recorded')).toBe(true);
    const store = createLtpStore(db);
    for (const u of UNDERLYINGS) expect(await store.countForDay(u, DAY)).toBeGreaterThan(0);
  });

  it('with no token stored it logs a login_required gap for each underlying and records nothing', async () => {
    const db = freshDb();
    const summary = await runScheduled(envOf(db), at('10:00'), fakeSource());
    expect(summary.results.map((r) => r.gap)).toEqual(['login_required', 'login_required', 'login_required']);
    expect((await createLtpStore(db).gapsForDay(DAY)).map((g) => g.reason)).toEqual(['login_required', 'login_required', 'login_required']);
  });

  it('outside 09:15 to 15:30, at the weekend and on holidays it does nothing and logs no gap', async () => {
    const db = freshDb();
    const env = envOf(db);
    await call(env, '/token', { method: 'PUT', body: JSON.stringify({ token: TOKEN }) });
    expect((await runScheduled(env, at('08:00'), fakeSource())).skipped).toBe('not_recording_minute');
    expect((await runScheduled(env, new Date(istTs('2026-10-10', '10:00', 20) * 1000), fakeSource())).skipped).toBe('not_recording_minute'); // Saturday
    expect(await createLtpStore(db).gapsForDay(DAY)).toEqual([]);
  });
});

describe('exporting a day to pull into the local database', () => {
  it('returns the day\'s rows for one underlying, and its gaps', async () => {
    const db = freshDb();
    const env = envOf(db);
    await call(env, '/token', { method: 'PUT', body: JSON.stringify({ token: TOKEN }) });
    await runScheduled(env, new Date(istTs(DAY, '10:00', 20) * 1000), fakeSource());
    const res = await call(env, `/export?date=${DAY}&underlying=NSE:NIFTY50-INDEX`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snapshots: Record<string, unknown>[]; gaps: unknown[] };
    expect(body.snapshots.length).toBeGreaterThan(0);
    expect(body.snapshots[0]).toMatchObject({ underlying: 'NSE:NIFTY50-INDEX', trade_date: DAY });
    expect(Object.keys(body.snapshots[0])).toEqual(expect.arrayContaining(['snapshot_ts', 'strike', 'side', 'ltp', 'oi', 'oi_change', 'volume', 'spot', 'step', 'bid', 'ask', 'futures']));
    expect(body.snapshots.every((r) => r.underlying === 'NSE:NIFTY50-INDEX')).toBe(true);
  });
  it('is 400 for a bad date or an unknown underlying', async () => {
    const env = envOf();
    expect((await call(env, '/export?date=12-10-2026&underlying=NSE:NIFTY50-INDEX')).status).toBe(400);
    expect((await call(env, `/export?date=${DAY}&underlying=NSE:EVIL`)).status).toBe(400);
    expect((await call(env, `/export?date=${DAY}`)).status).toBe(400);
  });
});

describe('receiving the agent journal pushed from the Mac (so the tablet can show it)', () => {
  const journalDb = () => createD1Fake(['drizzle/0008_ltp.sql', 'drizzle/0009_ltp_bidask.sql', 'drizzle/0010_ltp_agent.sql', 'cloud-recorder/schema.sql']);
  const decision = (id: string) => ({ decision_id: id, ts: 1000, trade_date: DAY, underlying: 'NSE:NIFTY50-INDEX', strategy_version: '0.1', setup: 'coa1_reversal', direction: 'long', book: 'both', taken: 1, skip_reason: null, context_json: '{}', trace_json: '[]', reason: 'why', expectation_json: '{}', data_quality_json: '{}' });
  const put = (env: Env, body: unknown) => call(env, '/journal', { method: 'PUT', body: JSON.stringify(body) });

  it('needs the secret like every other route', async () => {
    expect((await call(envOf(journalDb()), '/journal', { method: 'PUT', secret: null, body: '{}' })).status).toBe(401);
  });
  it('stores rows of an agent table, and a decision sent twice is kept as it was first written', async () => {
    const db = journalDb();
    const env = envOf(db);
    const first = await put(env, { table: 'agent_decisions', rows: [decision('d1'), decision('d2')] });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ written: 2 });
    await put(env, { table: 'agent_decisions', rows: [{ ...decision('d1'), reason: 'CHANGED' }] });
    expect((await db.prepare('SELECT reason FROM agent_decisions WHERE decision_id = ?').bind('d1').first<{ reason: string }>())?.reason).toBe('why');
    expect((await db.prepare('SELECT COUNT(*) AS n FROM agent_decisions').first<{ n: number }>())?.n).toBe(2);
  });
  it('a state row sent again replaces the old value', async () => {
    const db = journalDb();
    const env = envOf(db);
    await put(env, { table: 'agent_state', rows: [{ key: 'active_version', value: '0.1' }] });
    await put(env, { table: 'agent_state', rows: [{ key: 'active_version', value: '0.2' }] });
    expect((await db.prepare('SELECT value FROM agent_state WHERE key = ?').bind('active_version').first<{ value: string }>())?.value).toBe('0.2');
  });
  it('refuses a table that is not part of the journal, a column that does not exist, and too many rows', async () => {
    const env = envOf(journalDb());
    expect((await put(env, { table: 'recorder_token', rows: [{ id: 1, token: 'x', saved_at: 1 }] })).status).toBe(400);
    expect((await put(env, { table: 'ltp_snapshots', rows: [{ underlying: 'x' }] })).status).toBe(400);
    expect((await put(env, { table: 'agent_state', rows: [{ key: 'a', value: 'b', evil: 'c' }] })).status).toBe(400);
    expect((await put(env, { table: 'agent_state', rows: [{ 'key) VALUES (1); DROP TABLE agent_state; --': 'x' }] })).status).toBe(400);
    expect((await put(env, { table: 'agent_state', rows: Array.from({ length: 31 }, (_, i) => ({ key: `k${i}`, value: 'v' })) })).status).toBe(400);
    expect((await put(env, { table: 'agent_state', rows: [] })).status).toBe(400);
    expect((await call(env, '/journal', { method: 'PUT', body: 'nope' })).status).toBe(400);
  });
});
