import { getDatabaseBinding } from '@/db';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { assertPaperOnly } from '@/lib/execution-mode';
import { pullFromCloud } from '@/lib/ltp/cloud-pull';
import { istDate } from '@/lib/ltp/time';

const NO_STORE = { 'Cache-Control': 'no-store' };

// POST: pulls today's and yesterday's days from the cloud recorder into this app's database (rows already here are kept). The answer says how many
// rows came in; the recorder's secret is never returned.
export async function POST(request: Request) {
  try {
    assertPaperOnly();
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const now = Math.floor(Date.now() / 1000);
    const result = await pullFromCloud({ db: getDatabaseBinding(), url: process.env.LTP_RECORDER_URL, secret: process.env.LTP_RECORDER_SECRET, dates: [istDate(now - 86_400), istDate(now)] });
    return result.ok ? Response.json({ ok: true, snapshots: result.snapshots, gaps: result.gaps }, { headers: NO_STORE }) : Response.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  } catch (error) {
    console.error('ltp cloud-pull failed', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'Unable to pull from the cloud recorder.' }, { status: 500, headers: NO_STORE });
  }
}
