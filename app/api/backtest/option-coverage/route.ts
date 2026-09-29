import { queryAll, resolveRunId } from '@/lib/backtest/repository';

export async function GET(request: Request) {
  const runId = await resolveRunId(request);
  if (!runId) return Response.json({ runId: null, coverage: [] });
  return Response.json({ runId, coverage: await queryAll('SELECT * FROM option_data_metadata WHERE run_id=? ORDER BY cycle_id,stock_symbol,option_type,strike', runId) }, { headers: { 'Cache-Control': 'no-store' } });
}
