import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { assertPaperOnly } from '@/lib/execution-mode';
import { NO_STORE } from '@/lib/screener/api';
import { buildScreenerDeps } from '@/lib/screener/runtime';
import { startScreenerJob } from '@/lib/screener/service';

// Starts a scan or backtest as a background job and returns its id at once. Read-only: the job loads candles and quotes only.
export async function POST(request: Request) {
  try {
    assertPaperOnly();
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const result = await startScreenerJob(await buildScreenerDeps(request), body ?? {});
    if ('error' in result) return Response.json({ error: result.error }, { status: result.status, headers: NO_STORE });
    return Response.json({ jobId: result.jobId }, { status: 202, headers: NO_STORE });
  } catch (error) {
    console.error('screener job start failed', error);
    return Response.json({ error: 'Unable to start the screener job.' }, { status: 500, headers: NO_STORE });
  }
}
