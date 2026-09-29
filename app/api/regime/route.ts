import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { lastCompletedSession } from '@/lib/market-session';
import { marketSnapshot } from '@/lib/market-snapshot';
import type { RegimeErrorResponse } from '@/lib/regime/api-types';
import { buildRegimeResponse } from '@/lib/regime/build-response';
import { fetchDailyCandles } from '@/lib/regime/fyers-daily';
import { parseRegimeParams } from '@/lib/regime/params';
import { RegimeInputError } from '@/lib/regime/types';

const universe = new Set(marketSnapshot.map((stock) => stock.symbol));
const HISTORY_DAYS = 800; // about 3.3 years of calendar time, comfortably over the 313 sessions needed

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function fail(error: string, code: RegimeErrorResponse['code'], status: number) {
  return json({ error, code } satisfies RegimeErrorResponse, status);
}

// Read-only: this route only reads FYERS daily history. It never places, modifies or cancels orders.
export async function GET(request: Request) {
  const parsed = parseRegimeParams(new URL(request.url).searchParams, universe);
  if (!parsed.ok) return fail(parsed.error, 'BAD_REQUEST', 400);
  const credentials = fyersCredentials(request);
  if (!credentials) return fail('Connect FYERS to load daily prices.', 'NO_TOKEN', 401);

  const now = new Date();
  const latest = lastCompletedSession(now);
  const to = parsed.value.asOf && parsed.value.asOf < latest ? parsed.value.asOf : latest;
  const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const history = await fetchDailyCandles(credentials, parsed.value.symbol, from, to);
  if (!history.ok) return history.status === 401 ? fail(history.message, 'TOKEN_REJECTED', 401) : fail(history.message, 'UPSTREAM', 502);

  try {
    const response = buildRegimeResponse({ candles: history.candles, params: parsed.value, now });
    if ('error' in response) return fail(response.error, response.code, response.code === 'NO_DATA' ? 404 : 400);
    return json(response);
  } catch (error) {
    if (error instanceof RegimeInputError) return fail(error.message, 'UPSTREAM', 502);
    throw error;
  }
}
