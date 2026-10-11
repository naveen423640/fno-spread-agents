import { getDatabaseBinding } from '@/db';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { runAblation, runBacktest, type AblationResult, type BacktestReport } from '@/lib/board/backtest';
import { assembleHistory } from '@/lib/board/backtest-data';
import { createHistStore } from '@/lib/board/hist-store';
import { historyStatus, loadNextHistory } from '@/lib/board/hist-load';
import { istDay } from '@/lib/board/time';
import { assertPaperOnly } from '@/lib/execution-mode';

const NO_STORE = { 'Cache-Control': 'no-store' };
const memory = globalThis as typeof globalThis & { __boardReport?: { report: BacktestReport; computedAt: string; loaded: number }; __boardAblation?: { results: AblationResult[]; computedAt: string } };

// GET: how much history is cached, and the last report if one was computed. POST {action:'load'}: fetch the next few symbols'
// history from FYERS (call repeatedly until done). POST {action:'run'}: replay the cached history and compute the report.
export async function GET() {
  try {
    const status = await historyStatus(createHistStore(getDatabaseBinding()), istDay(Date.now()));
    return Response.json({ status, report: memory.__boardReport?.report ?? null, computedAt: memory.__boardReport?.computedAt ?? null, computedOnSymbols: memory.__boardReport?.loaded ?? null, ablation: memory.__boardAblation ?? null }, { headers: NO_STORE });
  } catch (error) {
    console.error('board backtest status failed', error);
    return Response.json({ error: 'Unable to read the backtest status.' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  try {
    assertPaperOnly();
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const store = createHistStore(getDatabaseBinding());
    const now = new Date();

    if (body?.action === 'load') {
      const credentials = fyersCredentials(request);
      if (!credentials) return Response.json({ loginRequired: true, error: 'Connect FYERS first.' }, { status: 401, headers: NO_STORE });
      const progress = await loadNextHistory({ store, credentials, now: () => now, limit: 20 });
      return Response.json(progress, { status: progress.loginRequired ? 401 : 200, headers: NO_STORE });
    }
    if (body?.action === 'run') {
      const { stocks, indices } = assembleHistory(await store.loadAll(), istDay(now.getTime()));
      const report = runBacktest(stocks, indices);
      memory.__boardReport = { report, computedAt: now.toISOString(), loaded: stocks.length };
      return Response.json({ report, computedAt: now.toISOString(), computedOnSymbols: stocks.length }, { headers: NO_STORE });
    }
    if (body?.action === 'ablate') {
      const { stocks, indices } = assembleHistory(await store.loadAll(), istDay(now.getTime()));
      const results = runAblation(stocks, indices);
      memory.__boardAblation = { results, computedAt: now.toISOString() };
      return Response.json(memory.__boardAblation, { headers: NO_STORE });
    }
    return Response.json({ error: 'Unknown action.' }, { status: 400, headers: NO_STORE });
  } catch (error) {
    console.error('board backtest failed', error);
    return Response.json({ error: 'The backtest request failed.' }, { status: 500, headers: NO_STORE });
  }
}
