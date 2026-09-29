import { queryAll } from './repository';

export async function preflightResponse(runId: string) {
  const [run] = await queryAll<{ id: string; status: string; phase: string; progress_percent: number; summary: string; started_at: string; completed_at: string | null }>('SELECT * FROM preflight_runs WHERE id=?', runId);
  if (!run) return null;
  const [cycleCount] = await queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM monthly_cycles WHERE run_id=?', runId);
  const [universeCount] = await queryAll<{ count: number; covered: number }>('SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN option_data_available=1 THEN 1 ELSE 0 END),0) AS covered FROM monthly_universe WHERE run_id=?', runId);
  const [coverageCount] = await queryAll<{ contracts: number; average: number }>('SELECT COUNT(*) AS contracts, COALESCE(AVG(completeness_percent),0) AS average FROM option_data_metadata WHERE run_id=?', runId);
  const quality = await queryAll<{ severity: string; code: string; message: string }>('SELECT severity,code,message FROM data_quality_results WHERE run_id=? ORDER BY id', runId);
  const failedCodes = new Set(quality.filter((item) => item.severity === 'FAIL').map((item) => item.code));
  const terminal = ['PASS', 'WARNING', 'FAIL'].includes(run.status);
  const checks = [
    { label: 'Six completed monthly expiries', status: cycleCount?.count === 6 ? 'pass' : terminal ? 'blocked' : 'pending', detail: cycleCount?.count === 6 ? 'Six cycles were dynamically reconstructed and persisted.' : `${cycleCount?.count ?? 0}/6 cycles persisted.` },
    { label: 'Historical monthly top-50 liquidity', status: (universeCount?.count ?? 0) === 300 ? 'pass' : terminal ? 'blocked' : 'pending', detail: `${universeCount?.count ?? 0}/300 stock-month snapshots identified without today-universe substitution.` },
    { label: 'Expired option strikes and one-minute candles', status: failedCodes.has('EXPIRED_OPTION_HISTORY_UNAVAILABLE') || failedCodes.has('FYERS_AUTHENTICATION_FAILED') ? 'blocked' : terminal && (coverageCount?.contracts ?? 0) === 0 ? 'blocked' : terminal ? 'pass' : 'pending', detail: `${coverageCount?.contracts ?? 0} contract coverage records; average completeness ${Number(coverageCount?.average ?? 0).toFixed(2)}%.` },
    { label: 'Spread reconstruction inputs', status: terminal && run.status !== 'FAIL' ? 'pass' : terminal ? 'blocked' : 'pending', detail: terminal ? 'See spread-candidate and quality endpoints for exact stock-cycle reasons.' : 'Awaiting option coverage.' },
    { label: 'Historical bid/ask', status: 'pending', detail: 'FYERS historical OHLCV has no bid/ask; execution is explicitly LTP_FALLBACK with configured slippage.' },
  ];
  return { runId: run.id, status: run.status, phase: run.phase, progressPercent: run.progress_percent, summary: run.summary, canRun: false, preflightPassed: run.status === 'PASS' || run.status === 'WARNING', counts: { cycles: cycleCount?.count ?? 0, stockMonths: universeCount?.count ?? 0, coveredStockMonths: universeCount?.covered ?? 0, optionContracts: coverageCount?.contracts ?? 0 }, checks, reasons: quality, startedAt: run.started_at, completedAt: run.completed_at };
}
