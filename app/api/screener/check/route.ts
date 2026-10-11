import { assertPaperOnly } from '@/lib/execution-mode';
import { failureStatus, NO_STORE, parseCheckQuery } from '@/lib/screener/api';
import { buildScreenerDeps } from '@/lib/screener/runtime';
import { runScreenerCheck } from '@/lib/screener/service';

// Read-only live option check: bid/ask and OI of both legs, debit versus width, breakeven and rupees per lot.
// It never places, modifies or cancels anything.
export async function GET(request: Request) {
  try {
    assertPaperOnly();
    const result = await runScreenerCheck(await buildScreenerDeps(request), parseCheckQuery(new URL(request.url).searchParams));
    return Response.json(result, { status: result.ok ? 200 : failureStatus(result.code), headers: NO_STORE });
  } catch (error) {
    console.error('screener check failed', error);
    return Response.json({ ok: false, code: 'UPSTREAM', message: 'Unable to run the check.' }, { status: 500, headers: NO_STORE });
  }
}
