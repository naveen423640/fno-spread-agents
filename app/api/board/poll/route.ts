import { getDatabaseBinding } from '@/db';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { pollOnce } from '@/lib/board/poll';
import { createBoardStore } from '@/lib/board/store';
import { assertPaperOnly } from '@/lib/execution-mode';

const NO_STORE = { 'Cache-Control': 'no-store' };

// The last poll's summary, kept in server memory so the raw FYERS field names can be inspected (GET). Market data only, no secrets.
const last = globalThis as typeof globalThis & { __boardLastPoll?: unknown };

export async function GET() {
  return Response.json(last.__boardLastPoll ?? { note: 'No poll has run since the server started.' }, { headers: NO_STORE });
}

// Records one snapshot of every F&O stock, its current-month future and the sector indices. Read-only market data: the only
// FYERS endpoints used are quotes and history. The FYERS login is the app's existing one (cookie, or FYERS_ACCESS_TOKEN).
export async function POST(request: Request) {
  try {
    assertPaperOnly();
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const credentials = fyersCredentials(request);
    if (!credentials) return Response.json({ ok: false, loginRequired: true, errors: ['Connect FYERS first.'] }, { status: 401, headers: NO_STORE });
    const body = (await request.json().catch(() => null)) as { force?: unknown } | null;
    const summary = await pollOnce({ store: createBoardStore(getDatabaseBinding()), credentials, now: () => new Date() }, { force: body?.force === true });
    last.__boardLastPoll = summary;
    return Response.json(summary, { status: summary.loginRequired ? 401 : 200, headers: NO_STORE });
  } catch (error) {
    console.error('board poll route failed', error);
    return Response.json({ ok: false, errors: ['Unable to record a snapshot.'] }, { status: 500, headers: NO_STORE });
  }
}
