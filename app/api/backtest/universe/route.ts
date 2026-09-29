import { queryAll, resolveRunId } from '@/lib/backtest/repository';

export async function GET(request: Request) {
  const runId = await resolveRunId(request);
  if (!runId) return Response.json({ runId: null, universe: [] });
  const cycleId = new URL(request.url).searchParams.get('cycleId');
  const sql = cycleId ? 'SELECT id,run_id,cycle_id,stock_symbol,liquidity_metric,liquidity_rank,fno_eligible,option_data_available,liquidity_methodology,lot_size FROM monthly_universe WHERE run_id=? AND cycle_id=? ORDER BY liquidity_rank' : 'SELECT id,run_id,cycle_id,stock_symbol,liquidity_metric,liquidity_rank,fno_eligible,option_data_available,liquidity_methodology,lot_size FROM monthly_universe WHERE run_id=? ORDER BY cycle_id,liquidity_rank';
  return Response.json({ runId, universe: await queryAll(sql, ...cycleId ? [runId, Number(cycleId)] : [runId]) }, { headers: { 'Cache-Control': 'no-store' } });
}
