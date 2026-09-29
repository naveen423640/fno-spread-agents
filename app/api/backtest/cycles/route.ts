import { queryAll, resolveRunId } from '@/lib/backtest/repository';

export async function GET(request: Request) {
  const runId = await resolveRunId(request);
  if (!runId) return Response.json({ runId: null, cycles: [] });
  return Response.json({ runId, cycles: await queryAll('SELECT * FROM monthly_cycles WHERE run_id=? ORDER BY cycle_order', runId) }, { headers: { 'Cache-Control': 'no-store' } });
}
