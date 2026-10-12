import { getDatabaseBinding } from '@/db';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { assertPaperOnly } from '@/lib/execution-mode';
import { pushJournal } from '@/lib/ltp-agent/cloud-sync';
import { istDate } from '@/lib/ltp/time';

const NO_STORE = { 'Cache-Control': 'no-store' };
const DAYS_BACK = 7;

// POST: copies the last week of the agent journal, and its small tables, to the cloud recorder's database so the tablet can show them. Read-only
// here: the local journal is not changed. The answer says only how many rows went; the recorder's secret is never returned.
export async function POST(request: Request) {
  try {
    assertPaperOnly();
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const fromDate = istDate(Math.floor(Date.now() / 1000) - DAYS_BACK * 86_400);
    const result = await pushJournal({ db: getDatabaseBinding(), url: process.env.LTP_RECORDER_URL, secret: process.env.LTP_RECORDER_SECRET, fromDate });
    return result.ok ? Response.json({ ok: true, rows: result.rows }, { headers: NO_STORE }) : Response.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  } catch (error) {
    console.error('ltp push-journal failed', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'Unable to push the journal.' }, { status: 500, headers: NO_STORE });
  }
}
