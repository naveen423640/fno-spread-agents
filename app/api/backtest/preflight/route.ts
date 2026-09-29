import { waitUntil } from 'cloudflare:workers';

import { preflightResponse } from '@/lib/backtest/api-response';
import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { createPreflightRun } from '@/lib/backtest/preflight-service';
import { latestRunId } from '@/lib/backtest/repository';
import type { ResearchConfiguration } from '@/lib/backtest/types';

export async function GET() {
  const runId = await latestRunId();
  if (!runId) return Response.json({ status: 'FAIL', canRun: false, summary: 'No preflight has been run yet.', checks: [] }, { status: 404 });
  return Response.json(await preflightResponse(runId), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const credentials = fyersCredentials(request);
  if (!credentials) return Response.json({ status: 'FAIL', canRun: false, summary: 'Connect FYERS before running the preflight.', checks: [] }, { status: 401 });
  const body = await request.json().catch(() => null) as { slippagePerLeg?: unknown; roundTripCosts?: unknown; asOfDate?: unknown } | null;
  const slippagePerLeg = typeof body?.slippagePerLeg === 'number' ? body.slippagePerLeg : Number.NaN;
  const roundTripCosts = typeof body?.roundTripCosts === 'number' ? body.roundTripCosts : Number.NaN;
  if (!Number.isFinite(slippagePerLeg) || slippagePerLeg < 0 || !Number.isFinite(roundTripCosts) || roundTripCosts < 0) {
    return Response.json({ status: 'FAIL', canRun: false, summary: 'Slippage per leg and round-trip costs are required non-negative numbers.', checks: [] }, { status: 400 });
  }
  const configuration: ResearchConfiguration = {
    completedCycles: 6, stocksPerCycle: 50, entryTimeIst: '09:20', minimumRewardRisk: 2,
    stopLoss: 'NONE', profitExitPercent: 80, forcedExitTimeIst: '15:15', slippagePerLeg, roundTripCosts,
  };
  const asOfDate = typeof body?.asOfDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.asOfDate) ? body.asOfDate : undefined;
  const { runId, task } = await createPreflightRun(credentials, configuration, asOfDate);
  waitUntil(task);
  return Response.json(await preflightResponse(runId), { status: 202, headers: { 'Cache-Control': 'no-store' } });
}
