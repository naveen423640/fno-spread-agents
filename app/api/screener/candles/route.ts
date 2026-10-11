import { failureStatus, NO_STORE, parseCheckQuery } from '@/lib/screener/api';
import { buildScreenerDeps } from '@/lib/screener/runtime';
import { candidateDetail } from '@/lib/screener/service';

// Chart series (price, SMA20/50/200, RSI), support and resistance, and the action plan for one candidate. Cached candles only.
export async function GET(request: Request) {
  try {
    const result = await candidateDetail(await buildScreenerDeps(request), parseCheckQuery(new URL(request.url).searchParams));
    return Response.json(result, { status: result.ok ? 200 : failureStatus(result.code), headers: NO_STORE });
  } catch (error) {
    console.error('screener candidate detail failed', error);
    return Response.json({ ok: false, code: 'NO_DATA', message: 'Unable to load the candidate.' }, { status: 500, headers: NO_STORE });
  }
}
