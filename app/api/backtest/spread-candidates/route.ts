import { queryAll, resolveRunId } from '@/lib/backtest/repository';

export async function GET(request: Request) {
  const runId = await resolveRunId(request);
  if (!runId) return Response.json({ runId: null, candidates: [] });
  return Response.json({ runId, candidates: await queryAll('SELECT * FROM spread_candidates WHERE run_id=? ORDER BY cycle_id,stock_symbol,direction,short_strike', runId) }, { headers: { 'Cache-Control': 'no-store' } });
}
