import { lastCompletedSession } from '../market-session';
import { HOLIDAYS } from '../screener/holidays';
import { EMPTY_PRIOR, foldDay, istDayOf, scanSymbol, type C5, type PriorTotals, type ScanResult } from './core';
import type { DataProvider } from './provider';
import type { VwapStore } from './store';
import type { UniverseEntry } from './universe';

export const UNRELIABLE_GAP_PCT = 20; // a one-day price jump above this with no volume spike looks like a split or bonus
export const VOLUME_SPIKE_MULTIPLE = 3;

export type SymbolScan = {
  entry: UniverseEntry;
  day: string;
  status: 'ok' | 'no-session' | 'error';
  error?: string;
  scan: ScanResult | null;
  unreliable: boolean;
  unreliableNote: string;
  sessionsInMonth: number; // completed sessions before this day that feed the month's VWAP
};

export class LoginRequiredError extends Error {
  constructor(message = 'The FYERS login has expired. Sign in again.') { super(message); this.name = 'LoginRequiredError'; }
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthOf = (day: string) => day.slice(0, 7);

// The date a scan should use: today during or after a trading session, otherwise the last completed session.
export function resolveScanDate(requested: string, now: Date): string {
  if (requested !== 'today') return requested;
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [hour, minute] = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
  const minutes = hour * 60 + minute;
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const tradingDay = weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(today);
  return tradingDay && minutes >= 9 * 60 + 15 ? today : lastCompletedSession(now, HOLIDAYS);
}

function groupByDay(candles: C5[]): Map<string, C5[]> {
  const out = new Map<string, C5[]>();
  for (const c of candles) { const d = istDayOf(c.t); out.set(d, [...(out.get(d) ?? []), c]); }
  return out;
}

// Scans one symbol for `day`. Cold start fetches the month to date once; later scans fetch only the days not yet cached.
export async function scanOne(deps: { provider: DataProvider; store: VwapStore; entry: UniverseEntry; day: string; nowSeconds?: number }): Promise<SymbolScan> {
  const { provider, store, entry, day } = deps;
  const month = monthOf(day);
  const base: SymbolScan = { entry, day, status: 'ok', scan: null, unreliable: false, unreliableNote: '', sessionsInMonth: 0 };
  try {
    let state = await store.state(entry.symbol, month);
    const fetchFrom = state ? addDays(state.checkedThrough, 1) : `${month}-01`;
    let todayCandles: C5[] | null = null;
    if (fetchFrom <= day) {
      const result = await provider.candles5m(entry.symbol, fetchFrom, day);
      if (!result.ok) {
        if (result.code === 'LOGIN_REQUIRED') throw new LoginRequiredError(result.message);
        return { ...base, status: 'error', error: result.message };
      }
      const byDay = groupByDay(result.value);
      let unreliable = state?.unreliable ?? false;
      let note = state?.unreliableNote ?? '';
      for (const d of [...byDay.keys()].filter((x) => x < day).sort()) {
        const candles = byDay.get(d)!;
        const before = await store.priorFor(entry.symbol, month, d);
        const folded = foldDay(before.prior, candles);
        const dayVolume = candles.reduce((a, c) => a + c.v, 0);
        const gapPct = before.prior.lastClose ? (candles[0].o / before.prior.lastClose - 1) * 100 : 0;
        if (Math.abs(gapPct) > UNRELIABLE_GAP_PCT && (before.avgDailyVolume === null || dayVolume < VOLUME_SPIKE_MULTIPLE * before.avgDailyVolume)) {
          unreliable = true;
          note = `${d}: ${gapPct.toFixed(0)}% gap with no volume spike (possible split or bonus)`;
        }
        await store.saveDay({ symbol: entry.symbol, month, day: d, sumPv: folded.sumPv, sumV: folded.sumV, lastClose: folded.lastClose ?? candles[candles.length - 1].c, lastVwap: folded.lastVwap, dayOpen: candles[0].o, dayVolume });
      }
      // Every day before `day` has now been asked for, whether or not it had candles (weekends, holidays), so it is not asked again.
      state = { checkedThrough: addDays(day, -1), unreliable, unreliableNote: note };
      await store.saveState(entry.symbol, month, state);
      todayCandles = byDay.get(day) ?? [];
    }
    const { prior, days, avgDailyVolume } = await store.priorFor(entry.symbol, month, day);
    if (todayCandles === null) {
      // The cache already covers everything before `day`; today's candles are the one fresh request.
      const result = await provider.candles5m(entry.symbol, day, day);
      if (!result.ok) {
        if (result.code === 'LOGIN_REQUIRED') throw new LoginRequiredError(result.message);
        return { ...base, status: 'error', error: result.message };
      }
      todayCandles = result.value.filter((c) => istDayOf(c.t) === day);
    }
    if (!todayCandles.length) return { ...base, status: 'no-session', sessionsInMonth: days, unreliable: state?.unreliable ?? false, unreliableNote: state?.unreliableNote ?? '' };
    const scan = scanSymbol(prior, todayCandles, { now: deps.nowSeconds });
    let unreliable = state?.unreliable ?? false;
    let note = state?.unreliableNote ?? '';
    if (scan.firstGapPct !== null && Math.abs(scan.firstGapPct) > UNRELIABLE_GAP_PCT) {
      const volumeSoFar = todayCandles.reduce((a, c) => a + c.v, 0);
      if (avgDailyVolume === null || volumeSoFar < VOLUME_SPIKE_MULTIPLE * avgDailyVolume) { unreliable = true; note = `${day}: ${scan.firstGapPct.toFixed(0)}% opening gap with no volume spike (possible split or bonus)`; }
    }
    return { ...base, scan, unreliable, unreliableNote: note, sessionsInMonth: days };
  } catch (error) {
    if (error instanceof LoginRequiredError) throw error;
    return { ...base, status: 'error', error: error instanceof Error ? error.message : 'scan failed' };
  }
}

export type UniverseScan = { day: string; results: SymbolScan[]; loginRequired: boolean; skipped: number };

// Scans a whole universe with a small worker pool. One failing symbol never stops the others; a login problem stops the run.
export async function scanUniverse(deps: { provider: DataProvider; store: VwapStore; entries: UniverseEntry[]; day: string; nowSeconds?: number; concurrency?: number; onProgress?: (done: number, total: number) => void }): Promise<UniverseScan> {
  const results: (SymbolScan | undefined)[] = Array.from({ length: deps.entries.length });
  let next = 0, done = 0, loginRequired = false;
  const worker = async () => {
    while (!loginRequired) {
      const index = next++;
      if (index >= deps.entries.length) return;
      try {
        results[index] = await scanOne({ provider: deps.provider, store: deps.store, entry: deps.entries[index], day: deps.day, nowSeconds: deps.nowSeconds });
      } catch (error) {
        if (error instanceof LoginRequiredError) { loginRequired = true; return; }
        results[index] = { entry: deps.entries[index], day: deps.day, status: 'error', error: 'scan failed', scan: null, unreliable: false, unreliableNote: '', sessionsInMonth: 0 };
      }
      done += 1;
      deps.onProgress?.(done, deps.entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? 6) }, worker));
  const finished = results.filter((r): r is SymbolScan => r !== undefined);
  return { day: deps.day, results: finished, loginRequired, skipped: deps.entries.length - finished.length };
}

export { EMPTY_PRIOR };
export type { PriorTotals };
