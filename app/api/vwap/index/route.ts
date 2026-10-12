import { getDatabaseBinding } from '@/db';
import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { createCachingProvider, type CacheStats } from '@/lib/vwap/backtest/history';
import { lastCompletedSession } from '@/lib/market-session';
import { HOLIDAYS } from '@/lib/screener/holidays';
import { indexSymbolsFor, loadIndexHistory } from '@/lib/vwap/backtest/index-load';
import { assertPaperOnly } from '@/lib/execution-mode';
import { createFyersProvider } from '@/lib/vwap/provider';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Fetches Nifty 50 and the current-month Nifty future (5-minute candles) from FYERS into the cache the backtest's index filter reads, and
// reports what came back. Read-only market data; uses your FYERS login. ?from=YYYY-MM-DD (default 2026-07-01) &to=YYYY-MM-DD (default today)
export async function GET(request: Request) {
  try {
    assertPaperOnly();
    const credentials = fyersCredentials(request);
    if (!credentials) return Response.json({ loginRequired: true, error: 'Connect FYERS first.' }, { status: 401, headers: NO_STORE });
    const url = new URL(request.url);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const date = (v: string | null, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
    const from = date(url.searchParams.get('from'), '2026-07-01');
    // Only finished sessions: today's candles are still forming and would make a partial day look like a whole one.
    const lastDone = lastCompletedSession(new Date(), HOLIDAYS);
    const requestedTo = date(url.searchParams.get('to'), lastDone);
    const to = requestedTo > lastDone ? lastDone : requestedTo;
    const stats: CacheStats = { fetched: [], cacheHits: 0 };
    const provider = createCachingProvider(createFyersProvider({ credentials }), getDatabaseBinding(), today, stats);
    const { reports, loginRequired } = await loadIndexHistory({ provider, symbols: indexSymbolsFor(today), from, to });
    if (loginRequired) return Response.json({ loginRequired: true, error: 'The FYERS login has expired. Sign in again.' }, { status: 401, headers: NO_STORE });
    return Response.json({ from, to, reports, fetched: stats.fetched, monthsFromCache: stats.cacheHits }, { headers: NO_STORE });
  } catch (error) {
    console.error('vwap index load failed', error);
    return Response.json({ error: 'The index load failed.' }, { status: 500, headers: NO_STORE });
  }
}
