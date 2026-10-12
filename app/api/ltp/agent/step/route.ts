import { getDatabaseBinding } from '@/db';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { agentCatchUp, finishDay, type AgentContext } from '@/lib/ltp-agent/agent';
import { createJournalStore } from '@/lib/ltp-agent/journal-store';
import { loadActiveStrategy } from '@/lib/ltp-agent/strategy-store';
import { UNDERLYINGS } from '@/lib/ltp/recorder';
import { createLtpStore } from '@/lib/ltp/store';
import { istDate } from '@/lib/ltp/time';

const NO_STORE = { 'Cache-Control': 'no-store' };

// POST: runs the paper agent for the current minute on every underlying (the runner script calls this a few seconds after the recorder), or
// with { action: 'finish_day' } closes anything still open at the end of the day. Reads the stored snapshots only: it never calls FYERS.
export async function POST(request: Request) {
  try {
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const db = getDatabaseBinding();
    const journal = createJournalStore(db);
    const strategy = await loadActiveStrategy(journal);
    const ctx: AgentContext = { store: createLtpStore(db), journal, strategy, paused: (await journal.getState('paused')) === 'true' };
    const now = Math.floor(Date.now() / 1000);
    const ts = Math.floor(now / 60) * 60;
    const results: Record<string, unknown> = {};
    for (const underlying of UNDERLYINGS) results[underlying] = body?.action === 'finish_day' ? { closed: await finishDay(ctx, underlying, istDate(ts)) } : await agentCatchUp(ctx, journal, underlying, now);
    await journal.setState('heartbeat_ts', String(now));
    return Response.json({ ts, version: strategy.version, paused: ctx.paused, results }, { headers: NO_STORE });
  } catch (error) {
    console.error('ltp agent step failed', error);
    return Response.json({ error: 'The agent step failed.' }, { status: 500, headers: NO_STORE });
  }
}
