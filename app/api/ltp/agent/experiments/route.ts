import { getDatabaseBinding } from '@/db';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { createD1AgentStore } from '@/lib/agents/store';
import { runExperiment } from '@/lib/ltp-agent/gate';
import { proposeExperiments } from '@/lib/ltp-agent/experiments';
import { createJournalStore } from '@/lib/ltp-agent/journal-store';
import { phaseOf, PhaseLockedError } from '@/lib/ltp-agent/phase';
import { buildReviewerLlm } from '@/lib/ltp-agent/reviewer';
import { loadActiveStrategy } from '@/lib/ltp-agent/strategy-store';
import { approveExperiment, ensureSplit, listVersions, rejectExperiment, rollbackTo } from '@/lib/ltp-agent/versions';
import { createLtpStore } from '@/lib/ltp/store';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET: phase, versions and every experiment. POST { action, id?, version? }: propose | run | approve | reject | rollback | pause | resume.
// Nothing here reaches FYERS and nothing here places an order; the agent is paper only.
export async function GET() {
  try {
    const journal = createJournalStore(getDatabaseBinding());
    const strategy = await loadActiveStrategy(journal);
    const closed = await journal.closedTradeCount(strategy.version);
    return Response.json({ activeVersion: strategy.version, phase: phaseOf(closed), closedTrades: closed, versions: await listVersions(journal), experiments: await journal.listExperiments() }, { headers: NO_STORE });
  } catch (error) {
    console.error('ltp agent experiments read failed', error);
    return Response.json({ error: 'Unable to read the experiments.' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  try {
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const body = (await request.json().catch(() => null)) as { action?: unknown; id?: unknown; version?: unknown } | null;
    const db = getDatabaseBinding();
    const journal = createJournalStore(db);
    const store = createLtpStore(db);
    const id = typeof body?.id === 'string' ? body.id : '';
    switch (body?.action) {
      case 'propose': {
        const llm = buildReviewerLlm(process.env, createD1AgentStore(db).logLlmCall);
        if (!llm) return Response.json({ error: 'ANTHROPIC_API_KEY is not set for the app, so no proposals can be made.' }, { status: 503, headers: NO_STORE });
        const strategy = await loadActiveStrategy(journal);
        return Response.json(await proposeExperiments({ llm, journal }, strategy, await ensureSplit({ store, journal }, strategy.version)), { headers: NO_STORE });
      }
      case 'run': return Response.json(await runExperiment({ store, journal, current: await loadActiveStrategy(journal) }, id), { headers: NO_STORE });
      case 'approve': return Response.json(await approveExperiment({ store, journal }, id), { headers: NO_STORE });
      case 'reject': await rejectExperiment(journal, id); return Response.json({ ok: true }, { headers: NO_STORE });
      case 'rollback': await rollbackTo(journal, typeof body.version === 'string' ? body.version : ''); return Response.json({ ok: true }, { headers: NO_STORE });
      case 'pause': case 'resume': await journal.setState('paused', body.action === 'pause' ? 'true' : 'false'); return Response.json({ ok: true, paused: body.action === 'pause' }, { headers: NO_STORE });
      default: return Response.json({ error: 'Unknown action.' }, { status: 400, headers: NO_STORE });
    }
  } catch (error) {
    if (error instanceof PhaseLockedError) return Response.json({ error: error.message, locked: true }, { status: 409, headers: NO_STORE });
    const message = error instanceof Error ? error.message : '';
    console.error('ltp agent experiments action failed', error);
    // Messages written by this code for the user (a wrong status, a missing experiment) are safe to show; anything else is not.
    return Response.json({ error: /^(No experiment|Experiment |Strategy version|Splitting|Invalid)/.test(message) ? message : 'The action failed.' }, { status: 400, headers: NO_STORE });
  }
}
