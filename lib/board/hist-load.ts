import { createFyersAdapter } from '@/lib/screener/broker/fyers';

import { fetchIntradayHistory } from './candles';
import { BOARD_CONFIG } from './config';
import type { HistStore } from './hist-store';
import { fetchFuturesOiSeries } from './oi';
import { istDay } from './time';
import { boardUniverse, SECTOR_INDEX_SYMBOLS } from './universe';
import type { C5 } from './zones';

export const HISTORY_DAYS = 100; // FYERS allows at most 100 days of intraday candles per request
const dayString = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export type LoadProgress = { loaded: number; total: number; done: boolean; loginRequired: boolean; failed: { symbol: string; message: string }[] };

// Loads the next few symbols' history (5-minute candles for 100 days, daily candles, daily futures OI) and stores them. One call loads
// a handful of symbols, so a request stays short; call it again until done. A symbol that fails is reported and retried next time.
export async function loadNextHistory(deps: { store: HistStore; credentials: { clientId: string; accessToken: string }; now: () => Date; limit: number; sleep?: (ms: number) => Promise<void> }): Promise<LoadProgress> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gap = BOARD_CONFIG.poll.historyGapMs;
  const now = deps.now();
  const today = istDay(now.getTime());
  const universe = boardUniverse(today);
  const targets = [...universe.map((u) => ({ symbol: u.symbol, futures: u.futures, index: false })), ...SECTOR_INDEX_SYMBOLS.map((symbol) => ({ symbol, futures: '', index: true }))];
  const loaded = await deps.store.loadedSymbols();
  const failed: { symbol: string; message: string }[] = [];
  const adapter = createFyersAdapter({ credentials: deps.credentials, sleep });
  const dailyFrom = dayString(now.getTime() - (HISTORY_DAYS + 60) * 86_400_000); // extra weeks so the first replayed day has 20 prior sessions
  let loginRequired = false;

  for (const t of targets.filter((x) => !loaded.has(x.symbol)).slice(0, deps.limit)) {
    const intraday = await fetchIntradayHistory(deps.credentials, t.symbol, '5', HISTORY_DAYS, now);
    await sleep(gap);
    if (!intraday.ok) {
      if (intraday.loginRequired) { loginRequired = true; break; }
      failed.push({ symbol: t.symbol, message: intraday.message });
      continue;
    }
    const byDay = new Map<string, C5[]>();
    for (const c of intraday.candles) {
      const day = dayString(c.t * 1000);
      byDay.set(day, [...(byDay.get(day) ?? []), c]);
    }
    let daily: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
    let oi: [string, number][] = [];
    if (!t.index) {
      const d = await adapter.history(t.symbol, { from: dailyFrom, to: today });
      if (!d.ok) { failed.push({ symbol: t.symbol, message: d.message }); continue; }
      daily = d.value;
      const series = await fetchFuturesOiSeries(deps.credentials, t.futures, dailyFrom, today);
      await sleep(gap);
      if (series.ok) oi = series.series;
      else if (series.loginRequired) { loginRequired = true; break; }
      // A future with no OI series still loads; its OI component is simply zero in the replay.
    }
    await deps.store.saveSymbol(t.symbol, { m5: byDay, daily, oi }, today);
  }
  const after = await deps.store.loadedSymbols();
  return { loaded: after.size, total: targets.length, done: after.size >= targets.length, loginRequired, failed: failed.slice(0, 10) };
}

export async function historyStatus(store: HistStore, todayIso: string): Promise<{ loaded: number; total: number }> {
  const universe = boardUniverse(todayIso);
  return { loaded: (await store.loadedSymbols()).size, total: universe.length + SECTOR_INDEX_SYMBOLS.length };
}
