import { preflightResponse } from '@/lib/backtest/api-response';
import { resolveRunId } from '@/lib/backtest/repository';

export async function GET(request: Request) {
  const runId = await resolveRunId(request);
  if (!runId) return Response.json({ error: 'No preflight run exists.' }, { status: 404 });
  const payload = await preflightResponse(runId);
  return payload ? Response.json(payload, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'Preflight run not found.' }, { status: 404 });
}
