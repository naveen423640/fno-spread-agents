import { assertPaperOnly } from '@/lib/execution-mode';
import { EMPTY_PRIOR, istDayOf, scanSymbol, vwapSeries, type PriorTotals } from '@/lib/vwap/core';
import { parseSource, vwapDeps } from '@/lib/vwap/runtime';
import { resolveScanDate } from '@/lib/vwap/service';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Candles, the month VWAP after each candle, and the cross events for the last few sessions of one symbol. Read-only.
// ?symbol=NSE:TCS-EQ&date=today|YYYY-MM-DD&source=fyers|cache&days=3
export async function GET(request: Request) {
  try {
    assertPaperOnly();
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol') ?? '';
    if (!/^NSE:[A-Z0-9&-]{1,30}-EQ$/.test(symbol)) return Response.json({ error: 'Unknown symbol.' }, { status: 400, headers: NO_STORE });
    const requested = url.searchParams.get('date') ?? 'today';
    if (requested !== 'today' && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return Response.json({ error: 'Invalid date.' }, { status: 400, headers: NO_STORE });
    const days = Math.min(5, Math.max(1, Math.floor(Number(url.searchParams.get('days')) || 3)));
    const source = parseSource(url.searchParams.get('source'));
    const deps = vwapDeps(request, source);
    if (!deps.ok) return Response.json({ loginRequired: true, error: 'Connect FYERS first.' }, { status: 401, headers: NO_STORE });

    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const day = resolveScanDate(requested, now);
    const result = await deps.provider.candles5m(symbol, `${day.slice(0, 7)}-01`, day);
    if (!result.ok) return Response.json({ error: result.message, loginRequired: result.code === 'LOGIN_REQUIRED' }, { status: result.code === 'LOGIN_REQUIRED' ? 401 : 502, headers: NO_STORE });

    const byDay = new Map<string, typeof result.value>();
    for (const c of result.value) { const d = istDayOf(c.t); byDay.set(d, [...(byDay.get(d) ?? []), c]); }
    const sessions = [...byDay.keys()].sort();
    let totals: PriorTotals = EMPTY_PRIOR;
    const out: { day: string; candles: typeof result.value; vwap: (number | null)[]; events: ReturnType<typeof scanSymbol>['events'] }[] = [];
    for (const d of sessions) {
      const candles = byDay.get(d)!;
      const scan = scanSymbol(totals, candles, { now: d === today ? Math.floor(now.getTime() / 1000) : undefined });
      out.push({ day: d, candles, vwap: vwapSeries(totals, candles), events: scan.events });
      totals = scan.totals;
    }
    return Response.json({ symbol, day, sessionsInMonth: sessions.length, days: out.slice(-days) }, { headers: NO_STORE });
  } catch (error) {
    console.error('vwap chart failed', error);
    return Response.json({ error: 'Unable to build the chart.' }, { status: 500, headers: NO_STORE });
  }
}
