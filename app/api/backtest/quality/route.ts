import { queryAll, resolveRunId } from '@/lib/backtest/repository';

export async function GET(request: Request) {
  const runId = await resolveRunId(request);
  if (!runId) return Response.json({ runId: null, results: [] });
  const severity = new URL(request.url).searchParams.get('severity');
  const sql = severity ? 'SELECT * FROM data_quality_results WHERE run_id=? AND severity=? ORDER BY id' : 'SELECT * FROM data_quality_results WHERE run_id=? ORDER BY id';
  return Response.json({ runId, results: await queryAll(sql, ...severity ? [runId, severity.toUpperCase()] : [runId]) }, { headers: { 'Cache-Control': 'no-store' } });
}
