import { waitUntil } from 'cloudflare:workers';

import { createDailyRun, dailyRunResponse, latestDailyRunId } from '@/lib/backtest/daily-service';
import type { ResearchConfiguration } from '@/lib/backtest/types';

export async function GET() {
  const runId = await latestDailyRunId();
  return runId ? Response.json(await dailyRunResponse(runId)) : Response.json({ status: 'EMPTY', mode: 'DAILY_PROXY' });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { slippagePerLeg?: unknown; roundTripCosts?: unknown; asOfDate?: unknown } | null;
  const slippagePerLeg = typeof body?.slippagePerLeg === 'number' ? body.slippagePerLeg : Number.NaN;
  const roundTripCosts = typeof body?.roundTripCosts === 'number' ? body.roundTripCosts : Number.NaN;
  if (!Number.isFinite(slippagePerLeg) || slippagePerLeg < 0 || !Number.isFinite(roundTripCosts) || roundTripCosts < 0) return Response.json({ status: 'FAIL', summary: 'Slippage per leg and round-trip costs are required non-negative numbers.' }, { status: 400 });
  const configuration: ResearchConfiguration = { completedCycles: 6, stocksPerCycle: 50, entryTimeIst: '09:20', minimumRewardRisk: 2, stopLoss: 'NONE', profitExitPercent: 80, forcedExitTimeIst: '15:15', slippagePerLeg, roundTripCosts };
  const asOfDate = typeof body?.asOfDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.asOfDate) ? body.asOfDate : undefined;
  const { runId, task } = await createDailyRun(configuration, asOfDate);
  waitUntil(task);
  return Response.json(await dailyRunResponse(runId), { status: 202, headers: { 'Cache-Control': 'no-store' } });
}
