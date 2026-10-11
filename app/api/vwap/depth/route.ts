import { assertPaperOnly } from '@/lib/execution-mode';
import { probeHistoryDepth } from '@/lib/vwap/depth';
import { parseSource, vwapDeps } from '@/lib/vwap/runtime';

const NO_STORE = { 'Cache-Control': 'no-store' };

// How far back does FYERS serve 5-minute candles for one symbol? Makes up to 15 history requests (one per 100-day window), read-only.
// ?symbol=NSE:TCS-EQ  (uses your FYERS login; add &source=cache to see what the offline board cache holds instead)
export async function GET(request: Request) {
  try {
    assertPaperOnly();
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol') ?? 'NSE:TCS-EQ';
    if (!/^NSE:[A-Z0-9&-]{1,30}-EQ$/.test(symbol)) return Response.json({ error: 'Unknown symbol.' }, { status: 400, headers: NO_STORE });
    const deps = vwapDeps(request, parseSource(url.searchParams.get('source')));
    if (!deps.ok) return Response.json({ loginRequired: true, error: 'Connect FYERS first.' }, { status: 401, headers: NO_STORE });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return Response.json(await probeHistoryDepth(deps.provider, symbol, today), { headers: NO_STORE });
  } catch (error) {
    console.error('vwap depth probe failed', error);
    return Response.json({ error: 'The probe failed.' }, { status: 500, headers: NO_STORE });
  }
}
