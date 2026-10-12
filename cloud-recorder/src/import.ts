// Puts a day exported by the cloud recorder (GET /export) into a local database. INSERT OR IGNORE: a row already here is kept, so the Mac's own
// recording and the cloud's merge, with the cloud filling the minutes the Mac missed.
import type { D1Like } from '@/lib/agents/store';

const SNAPSHOT_COLUMNS = ['underlying', 'expiry', 'snapshot_ts', 'trade_date', 'strike', 'side', 'ltp', 'oi', 'oi_change', 'volume', 'spot', 'step', 'fetch_latency_ms', 'flags', 'bid', 'ask', 'futures'];
const REQUIRED = ['underlying', 'expiry', 'snapshot_ts', 'trade_date', 'strike', 'side', 'spot', 'step'];
const GAP_COLUMNS = ['underlying', 'minute_ts', 'trade_date', 'reason', 'detail'];

type Bindable = string | number | null;
export type Export = { snapshots: Record<string, Bindable | undefined>[]; gaps: Record<string, Bindable | undefined>[] };

export async function importExport(db: D1Like, body: Export): Promise<{ snapshots: number; gaps: number }> {
  if (!body || !Array.isArray(body.snapshots) || !Array.isArray(body.gaps)) throw new Error('That is not an export from the cloud recorder.');
  body.snapshots.forEach((r, i) => { for (const c of REQUIRED) if (r[c] === undefined || r[c] === null) throw new Error(`Export row ${i + 1} has no ${c}.`); });
  const insert = db.prepare(`INSERT OR IGNORE INTO ltp_snapshots (${SNAPSHOT_COLUMNS.join(', ')}) VALUES (${SNAPSHOT_COLUMNS.map(() => '?').join(', ')})`);
  for (const r of body.snapshots) await insert.bind(...SNAPSHOT_COLUMNS.map((c) => r[c] ?? (c === 'flags' ? '' : null))).run();
  const insertGap = db.prepare(`INSERT OR IGNORE INTO recorder_gaps (${GAP_COLUMNS.join(', ')}) VALUES (${GAP_COLUMNS.map(() => '?').join(', ')})`);
  for (const g of body.gaps) await insertGap.bind(...GAP_COLUMNS.map((c) => g[c] ?? (c === 'detail' ? '' : null))).run();
  return { snapshots: body.snapshots.length, gaps: body.gaps.length };
}
