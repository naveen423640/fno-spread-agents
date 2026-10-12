// Copies the agent journal from this Mac's database to the cloud recorder's database, so the tablet's LTP Agent tab can show it while the Mac is off.
// One way, read-only on this side: nothing here changes the local journal. Server-side only; the recorder's secret never reaches the browser.
import type { D1Like } from '@/lib/agents/store';

export type PushResult = { ok: true; rows: number } | { ok: false; status: number; error: string };
const CHUNK = 25; // rows per request: each row is one database call in the Worker

type Row = Record<string, string | number | null>;
const all = async (db: D1Like, sql: string, ...bind: (string | number)[]) => (await db.prepare(sql).bind(...bind).all<Row>()).results;

// Decisions and everything that hangs off them from `fromDate` on; the strategy list, state and experiments whole (they are small).
async function collect(db: D1Like, fromDate: string): Promise<{ table: string; rows: Row[] }[]> {
  const recent = "decision_id IN (SELECT decision_id FROM agent_decisions WHERE trade_date >= ?)";
  return [
    { table: 'agent_decisions', rows: await all(db, 'SELECT * FROM agent_decisions WHERE trade_date >= ? ORDER BY ts, decision_id', fromDate) },
    { table: 'agent_trades', rows: await all(db, `SELECT * FROM agent_trades WHERE ${recent}`, fromDate) },
    { table: 'trade_outcomes', rows: await all(db, 'SELECT * FROM trade_outcomes WHERE trade_date >= ?', fromDate) },
    { table: 'trade_reviews', rows: await all(db, `SELECT * FROM trade_reviews WHERE ${recent}`, fromDate) },
    { table: 'agent_experiments', rows: await all(db, 'SELECT * FROM agent_experiments') },
    { table: 'agent_state', rows: await all(db, 'SELECT * FROM agent_state') },
    { table: 'agent_strategies', rows: await all(db, 'SELECT * FROM agent_strategies') },
  ];
}

export async function pushJournal(deps: { db: D1Like; url: string | undefined; secret: string | undefined; fromDate: string; fetchImpl?: typeof fetch }): Promise<PushResult> {
  if (!deps.url || !deps.secret) return { ok: false, status: 503, error: 'Set LTP_RECORDER_URL and LTP_RECORDER_SECRET in .env.local and restart the app.' };
  const base = deps.url.replace(/\/$/, '');
  let sent = 0;
  try {
    for (const { table, rows } of await collect(deps.db, deps.fromDate)) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const response = await (deps.fetchImpl ?? fetch)(`${base}/journal`, { method: 'PUT', headers: { Authorization: `Bearer ${deps.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ table, rows: chunk }) });
        if (!response.ok) return { ok: false, status: 502, error: `The cloud recorder answered ${response.status}${response.status === 401 ? ': LTP_RECORDER_SECRET is not the secret set on the Worker.' : '.'}` };
        sent += chunk.length;
      }
    }
    return { ok: true, rows: sent };
  } catch {
    return { ok: false, status: 502, error: 'Could not push to the cloud recorder.' };
  }
}
