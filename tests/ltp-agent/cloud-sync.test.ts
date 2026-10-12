import { describe, expect, it } from 'vitest';

import { pushJournal } from '@/lib/ltp-agent/cloud-sync';
import { createD1Fake } from '../support/d1-fake';

const URL_BASE = 'https://ltp-recorder.example.workers.dev';
const SECRET = 'admin-secret-123';
const local = () => createD1Fake(['drizzle/0010_ltp_agent.sql']);
const decision = (id: string, date: string) => ['INSERT INTO agent_decisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, 1000, date, 'NSE:NIFTY50-INDEX', '0.1', 'coa1_reversal', 'long', 'both', 1, null, '{}', '[]', 'why', '{}', '{}'] as const;
async function seed(db: ReturnType<typeof local>, ids: [string, string][]) {
  for (const [id, date] of ids) { const [sql, ...bind] = decision(id, date); await db.prepare(sql).bind(...(bind as (string | number | null)[])).run(); }
}

function recorder(status = 200) {
  const sent: { table: string; rows: Record<string, unknown>[]; auth: string }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as { table: string; rows: Record<string, unknown>[] };
    sent.push({ ...body, auth: (init?.headers as Record<string, string>).Authorization });
    return status === 200 ? Response.json({ written: body.rows.length }) : new Response('{}', { status });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

describe('pushJournal: sending the agent journal from the Mac to the cloud recorder', () => {
  it('sends decisions of the last days only, with their trades, outcomes and reviews, and the small tables whole', async () => {
    const db = local();
    await seed(db, [['recent', '2026-10-12'], ['old', '2026-09-01']]);
    await db.prepare('INSERT INTO agent_trades VALUES (?,?,?,?,?)').bind('recent', 'buy', 'closed', 1, '{}').run();
    await db.prepare('INSERT INTO agent_trades VALUES (?,?,?,?,?)').bind('old', 'buy', 'closed', 1, '{}').run();
    await db.prepare('INSERT INTO trade_outcomes VALUES (?,?,?,?,?,?)').bind('recent', 'buy', '2026-10-12', 2, 10, '{}').run();
    await db.prepare('INSERT INTO trade_outcomes VALUES (?,?,?,?,?,?)').bind('old', 'buy', '2026-09-01', 2, 10, '{}').run();
    await db.prepare('INSERT INTO trade_reviews VALUES (?,?,?,?)').bind('recent', 'm', '{}', 3).run();
    await db.prepare('INSERT INTO trade_reviews VALUES (?,?,?,?)').bind('old', 'm', '{}', 3).run();
    await db.prepare('INSERT INTO agent_state VALUES (?,?)').bind('active_version', '0.1').run();
    await db.prepare('INSERT INTO agent_strategies VALUES (?,?,?,?)').bind('0.1', 'yaml', 'log', 4).run();
    const { sent, fetchImpl } = recorder();
    const result = await pushJournal({ db, url: `${URL_BASE}/`, secret: SECRET, fromDate: '2026-10-05', fetchImpl });
    expect(result).toEqual({ ok: true, rows: 6 });
    const byTable = Object.fromEntries(sent.map((s) => [s.table, s.rows.map((r) => r.decision_id ?? r.key ?? r.version)]));
    expect(byTable).toEqual({ agent_decisions: ['recent'], agent_trades: ['recent'], trade_outcomes: ['recent'], trade_reviews: ['recent'], agent_state: ['active_version'], agent_strategies: ['0.1'] });
    expect(sent.every((s) => s.auth === `Bearer ${SECRET}`)).toBe(true);
  });
  it('sends at most 25 rows per request', async () => {
    const db = local();
    await seed(db, Array.from({ length: 60 }, (_, i) => [`d${String(i).padStart(2, '0')}`, '2026-10-12'] as [string, string]));
    const { sent, fetchImpl } = recorder();
    expect(await pushJournal({ db, url: URL_BASE, secret: SECRET, fromDate: '2026-10-05', fetchImpl })).toEqual({ ok: true, rows: 60 });
    expect(sent.filter((s) => s.table === 'agent_decisions').map((s) => s.rows.length)).toEqual([25, 25, 10]);
  });
  it('with nothing to send it sends nothing', async () => {
    const { sent, fetchImpl } = recorder();
    expect(await pushJournal({ db: local(), url: URL_BASE, secret: SECRET, fromDate: '2026-10-05', fetchImpl })).toEqual({ ok: true, rows: 0 });
    expect(sent).toHaveLength(0);
  });
  it('without the recorder address or secret it says what to set', async () => {
    const { sent, fetchImpl } = recorder();
    for (const over of [{ url: undefined }, { secret: undefined }]) {
      expect(await pushJournal({ db: local(), url: URL_BASE, secret: SECRET, fromDate: '2026-10-05', fetchImpl, ...over })).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/LTP_RECORDER_URL.*LTP_RECORDER_SECRET/) });
    }
    expect(sent).toHaveLength(0);
  });
  it('a refusal or an unreachable recorder is reported, never with the secret', async () => {
    const db = local();
    await seed(db, [['recent', '2026-10-12']]);
    expect(await pushJournal({ db, url: URL_BASE, secret: SECRET, fromDate: '2026-10-05', fetchImpl: recorder(401).fetchImpl })).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/401.*secret/i) });
    const down = await pushJournal({ db, url: URL_BASE, secret: SECRET, fromDate: '2026-10-05', fetchImpl: (async () => { throw new Error(`failed ${SECRET}`); }) as unknown as typeof fetch });
    expect(down).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(down)).not.toContain(SECRET);
  });
});
