// The cloud recorder: the same minute recorder as the app (lib/ltp/recorder.ts), run by a Cloudflare cron trigger so snapshots keep being taken while
// the Mac is off. Read-only market data; nothing here can place an order. The FYERS access token is put in by hand each morning (PUT /token) and is
// never returned, logged or exported. Every route needs the ADMIN_SECRET as a Bearer token.
import type { D1Like } from '@/lib/agents/store';
import { LTP_CONFIG } from '@/lib/ltp/config';
import { health, recordOnce, UNDERLYINGS, type ChainSource, type RecordSummary } from '@/lib/ltp/recorder';
import { createLtpStore } from '@/lib/ltp/store';
import { createFyersAdapter } from '@/lib/screener/broker/fyers';
import { HOLIDAYS } from '@/lib/screener/holidays';

export type Env = { DB: D1Like; ADMIN_SECRET: string; FYERS_CLIENT_ID: string };
type MakeSource = (credentials: { clientId: string; accessToken: string }) => ChainSource;

const MAX_TOKEN_LENGTH = 4000;
const MAX_JOURNAL_ROWS = 30; // each row is one database call, and a Worker run may make only so many
// The agent journal tables the Mac may push. Decisions and outcomes are written once, so a repeat is ignored; the rest are replaced by the newer copy.
const JOURNAL_TABLES: Record<string, 'ignore' | 'replace'> = { agent_decisions: 'ignore', trade_outcomes: 'ignore', agent_trades: 'replace', trade_reviews: 'replace', agent_experiments: 'replace', agent_state: 'replace', agent_strategies: 'replace' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function readToken(db: D1Like): Promise<{ token: string; savedAt: number } | null> {
  const row = await db.prepare('SELECT token, saved_at FROM recorder_token WHERE id = 1').first<{ token: string; saved_at: number }>();
  return row ? { token: row.token, savedAt: row.saved_at } : null;
}

// With no token every underlying fails the same way the app's recorder does when FYERS says the login is missing.
const noLogin: ChainSource = { async optionChain() { return { ok: false, code: 'LOGIN_REQUIRED', message: 'No FYERS token has been put in for today. PUT /token with the morning token.' }; } };

export async function runScheduled(env: Env, now: Date, makeSource: MakeSource = (credentials) => createFyersAdapter({ credentials })): Promise<RecordSummary> {
  const stored = await readToken(env.DB);
  const adapter = stored ? makeSource({ clientId: env.FYERS_CLIENT_ID, accessToken: stored.token }) : noLogin;
  return recordOnce({ adapter, store: createLtpStore(env.DB), now: () => now, underlyings: UNDERLYINGS, strikecount: LTP_CONFIG.strikecount, holidays: HOLIDAYS });
}

// Compares in time that does not depend on where the strings first differ.
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function handleRequest(request: Request, env: Env, now: Date = new Date()): Promise<Response> {
  if (!env.ADMIN_SECRET) return json({ error: 'The recorder has no ADMIN_SECRET configured.' }, 503);
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!sameSecret(given, env.ADMIN_SECRET)) return json({ error: 'Unauthorized.' }, 401);

  const url = new URL(request.url);
  const nowTs = Math.floor(now.getTime() / 1000);

  if (request.method === 'PUT' && url.pathname === '/token') {
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!token || token.length > MAX_TOKEN_LENGTH) return json({ error: 'Send {"token": "<today\'s FYERS access token>"}.' }, 400);
    await env.DB.prepare('INSERT INTO recorder_token (id, token, saved_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, saved_at = excluded.saved_at').bind(token, nowTs).run();
    return json({ ok: true, savedAt: nowTs });
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    const stored = await readToken(env.DB);
    return json({ ...(await health(createLtpStore(env.DB), nowTs, UNDERLYINGS, HOLIDAYS)), token: { present: stored !== null, savedAt: stored?.savedAt ?? null } });
  }

  if (request.method === 'GET' && url.pathname === '/export') {
    const date = url.searchParams.get('date') ?? '';
    const underlying = url.searchParams.get('underlying') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !UNDERLYINGS.includes(underlying)) return json({ error: 'Give date=YYYY-MM-DD and underlying=one of the recorded indices.' }, 400);
    const snapshots = (await env.DB.prepare('SELECT * FROM ltp_snapshots WHERE trade_date = ? AND underlying = ? ORDER BY snapshot_ts, strike, side').bind(date, underlying).all()).results;
    const gaps = (await env.DB.prepare('SELECT * FROM recorder_gaps WHERE trade_date = ? AND underlying = ? ORDER BY minute_ts').bind(date, underlying).all()).results;
    return json({ snapshots, gaps });
  }

  if (request.method === 'PUT' && url.pathname === '/journal') {
    const body = (await request.json().catch(() => null)) as { table?: unknown; rows?: unknown } | null;
    const table = typeof body?.table === 'string' ? body.table : '';
    const rows = body?.rows;
    if (!Object.hasOwn(JOURNAL_TABLES, table) || !Array.isArray(rows) || rows.length === 0 || rows.length > MAX_JOURNAL_ROWS) return json({ error: `Send {"table": one of ${Object.keys(JOURNAL_TABLES).join(', ')}, "rows": 1 to ${MAX_JOURNAL_ROWS} rows}.` }, 400);
    const columns = new Set(((await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results).map((c) => c.name));
    for (const row of rows as Record<string, unknown>[]) {
      const keys = row && typeof row === 'object' ? Object.keys(row) : [];
      if (!keys.length || keys.some((k) => !columns.has(k))) return json({ error: 'A row has a column that this table does not have.' }, 400);
    }
    for (const row of rows as Record<string, string | number | null>[]) {
      const keys = Object.keys(row);
      await env.DB.prepare(`INSERT OR ${JOURNAL_TABLES[table] === 'ignore' ? 'IGNORE' : 'REPLACE'} INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...keys.map((k) => row[k] ?? null)).run();
    }
    return json({ written: rows.length });
  }

  return json({ error: 'Not found.' }, 404);
}
