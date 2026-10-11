import { getDatabaseBinding } from '@/db';
import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { candlesFromSnapshots, fetchIntradayHistory } from '@/lib/board/candles';
import { BOARD_CONFIG } from '@/lib/board/config';
import { createBoardStore } from '@/lib/board/store';
import { istDay } from '@/lib/board/time';
import { boardUniverse } from '@/lib/board/universe';
import { computeZones, summarize, type C5 } from '@/lib/board/zones';
import { assertPaperOnly } from '@/lib/execution-mode';
import { createFyersAdapter } from '@/lib/screener/broker/fyers';
import type { Candle } from '@/lib/screener/types';

const NO_STORE = { 'Cache-Control': 'no-store' };
const last = globalThis as typeof globalThis & { __boardLastZones?: unknown; __boardDailyCache?: Map<string, { day: string; candles: Candle[] }>; __boardIntradayCache?: Map<string, { at: number; candles: C5[] }> };
const dailyCache = (last.__boardDailyCache ??= new Map());
const intradayCache = (last.__boardIntradayCache ??= new Map());
const dayString = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// Candles plus detected zones for one stock. Read-only. Intraday candles come from FYERS history (cached for a minute), or from
// the stored minute snapshots if history fails. ?last=1 returns the previous request's diagnostics without calling FYERS.
export async function GET(request: Request) {
  try {
    assertPaperOnly();
    const url = new URL(request.url);
    if (url.searchParams.get('last')) return Response.json(last.__boardLastZones ?? { note: 'No zones request yet.' }, { headers: NO_STORE });

    const symbol = url.searchParams.get('symbol') ?? '';
    const now = new Date();
    const entry = boardUniverse(istDay(now.getTime())).find((u) => u.symbol === symbol); // only symbols on the board can be requested
    if (!entry) return Response.json({ error: 'Unknown symbol.' }, { status: 400, headers: NO_STORE });
    const direction = url.searchParams.get('direction') === 'bear' ? 'bear' : 'bull';
    const credentials = fyersCredentials(request);
    const store = createBoardStore(getDatabaseBinding());
    const diagnostics: Record<string, unknown> = {};

    let intraday: C5[] = [];
    let source: 'history' | 'snapshots' | 'none' = 'none';
    const cached = intradayCache.get(symbol);
    if (cached && now.getTime() - cached.at < 60_000) { intraday = cached.candles; source = 'history'; }
    else if (credentials) {
      const result = await fetchIntradayHistory(credentials, symbol, BOARD_CONFIG.zones.intraday.resolution, BOARD_CONFIG.zones.intraday.calendarDays, now);
      if (result.ok) { intraday = result.candles; source = 'history'; intradayCache.set(symbol, { at: now.getTime(), candles: intraday }); }
      else diagnostics.historyError = result.message;
      // How far back does intraday history go? One-off probe on request: ?probe=1 asks for the widest window FYERS allows per call.
      if (url.searchParams.get('probe')) {
        const probes: Record<string, unknown> = {};
        for (const days of [30, 100, 200]) {
          const probe = await fetchIntradayHistory(credentials, symbol, BOARD_CONFIG.zones.intraday.resolution, days, now);
          probes[`${days}d`] = probe.ok ? { candles: probe.candles.length, first: new Date(probe.candles[0].t * 1000).toISOString(), last: new Date(probe.candles[probe.candles.length - 1].t * 1000).toISOString() } : { error: probe.message };
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        diagnostics.depthProbe = probes;
      }
    }
    if (!intraday.length) {
      const fromTs = Math.floor(now.getTime() / 1000) - 8 * 86_400;
      intraday = candlesFromSnapshots(await store.seriesFor(symbol, fromTs));
      if (intraday.length) source = 'snapshots';
    }

    let daily: Candle[] = [];
    const today = istDay(now.getTime());
    const dailyCached = dailyCache.get(symbol);
    if (dailyCached && dailyCached.day === today) daily = dailyCached.candles;
    else if (credentials) {
      const from = dayString(now.getTime() - BOARD_CONFIG.zones.daily.calendarDays * 86_400_000);
      const result = await createFyersAdapter({ credentials }).history(symbol, { from, to: today });
      if (result.ok) { daily = result.value; dailyCache.set(symbol, { day: today, candles: daily }); }
      else diagnostics.dailyError = result.message;
    }

    const latest = (await store.snapshotsAt((await store.latestTs())?.ts ?? 0)).find((r) => r.symbol === symbol);
    const price = latest?.ltp ?? intraday[intraday.length - 1]?.c ?? 0;
    const zones = computeZones({ intraday, daily, price, config: BOARD_CONFIG.zones });
    const body = {
      symbol, ticker: entry.ticker, price, direction, source, candles: intraday.slice(-3 * 78), daily: daily.slice(-5), zones,
      summary: summarize({ ...zones, price, direction }),
      stats: { intradayCandles: intraday.length, firstTs: intraday[0]?.t ?? null, lastTs: intraday[intraday.length - 1]?.t ?? null, dailyCandles: daily.length },
      diagnostics,
    };
    // Keep the last request that had a FYERS login, so a later request without one does not hide what FYERS returned.
    if (credentials || !last.__boardLastZones) last.__boardLastZones = { ...body, candles: undefined, sampleCandles: intraday.slice(0, 2), hadLogin: Boolean(credentials) };
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    console.error('board zones failed', error);
    return Response.json({ error: 'Unable to compute zones.' }, { status: 500, headers: NO_STORE });
  }
}
