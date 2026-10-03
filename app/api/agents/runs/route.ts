import { buildStartDeps } from '@/lib/agent-service/runtime';
import { startAgentRun } from '@/lib/agent-service/service';
import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { assertPaperOnly } from '@/lib/execution-mode';

const headers = { 'Cache-Control': 'no-store' };

// Starts a research-team run and returns its id at once; the work continues in the background.
// The team can only advise (veto, reduce, delay). This route never places, modifies or cancels anything.
export async function POST(request: Request) {
  try {
    assertPaperOnly();
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers });
    const body = await request.json().catch(() => null);
    const result = await startAgentRun(await buildStartDeps(), body, fyersCredentials(request));
    if ('error' in result) return Response.json({ error: result.error }, { status: result.status, headers });
    return Response.json({ runId: result.runId }, { status: 202, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to start the research team.' }, { status: 500, headers });
  }
}
