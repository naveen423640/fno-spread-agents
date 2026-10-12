import { getDatabaseBinding } from '@/db';
import { createJournalStore } from '@/lib/ltp-agent/journal-store';
import { buildAgentState } from '@/lib/ltp-agent/state';
import { createLtpStore } from '@/lib/ltp/store';
import { HOLIDAYS } from '@/lib/screener/holidays';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET ?date=YYYY-MM-DD: what the Agent tab shows. Reads the journal and the stored snapshots only; it never calls FYERS.
export async function GET(request: Request) {
  try {
    const date = new URL(request.url).searchParams.get('date') ?? undefined;
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'date must be YYYY-MM-DD.' }, { status: 400, headers: NO_STORE });
    const db = getDatabaseBinding();
    return Response.json(await buildAgentState({ store: createLtpStore(db), journal: createJournalStore(db), holidays: HOLIDAYS }, { date, nowTs: Math.floor(Date.now() / 1000) }), { headers: NO_STORE });
  } catch (error) {
    console.error('ltp agent state failed', error);
    return Response.json({ error: 'Unable to read the agent state.' }, { status: 500, headers: NO_STORE });
  }
}
