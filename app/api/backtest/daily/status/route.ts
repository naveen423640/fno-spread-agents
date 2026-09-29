import { dailyRunResponse, latestDailyRunId } from '@/lib/backtest/daily-service';

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get('runId') ?? await latestDailyRunId();
  if (!runId) return Response.json({ status: 'EMPTY', mode: 'DAILY_PROXY' }, { status: 404 });
  const payload = await dailyRunResponse(runId);
  return payload ? Response.json(payload, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'Daily run not found.' }, { status: 404 });
}
