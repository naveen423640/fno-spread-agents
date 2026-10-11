import type { DataProvider } from './provider';
import { expectedFirstSession } from './backtest/history';
import { istDayOf } from './core';

export type DepthWindow = { from: string; to: string; candles: number; firstDay: string | null; lastDay: string | null };
export type DepthResult = {
  symbol: string;
  earliestDay: string | null; // the oldest session with 5-minute candles that the probe found
  sessionsSeen: number;
  windows: DepthWindow[];
  stoppedBecause: 'no older data' | 'error' | 'window limit';
  error?: string;
  monthsFullyCovered: string[]; // calendar months whose first session is present, so the monthly VWAP anchor is right
};

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Walks back from `today` in windows of up to 100 days (FYERS's per-request cap for intraday candles) until a window comes back empty
// or FYERS refuses it, and reports the oldest 5-minute candle it saw. Each window is one request; the provider's own rate limiter paces them.
export async function probeHistoryDepth(provider: DataProvider, symbol: string, today: string, options: { windowDays?: number; maxWindows?: number } = {}): Promise<DepthResult> {
  const windowDays = options.windowDays ?? 100;
  const maxWindows = options.maxWindows ?? 15;
  const windows: DepthWindow[] = [];
  const days = new Set<string>();
  let end = today;
  let stoppedBecause: DepthResult['stoppedBecause'] = 'window limit';
  let error: string | undefined;

  for (let i = 0; i < maxWindows; i += 1) {
    const from = addDays(end, -(windowDays - 1));
    const result = await provider.candles5m(symbol, from, end);
    if (!result.ok) { stoppedBecause = 'error'; error = result.message; windows.push({ from, to: end, candles: 0, firstDay: null, lastDay: null }); break; }
    const windowDaysSeen = [...new Set(result.value.map((c) => istDayOf(c.t)))].sort();
    windows.push({ from, to: end, candles: result.value.length, firstDay: windowDaysSeen[0] ?? null, lastDay: windowDaysSeen[windowDaysSeen.length - 1] ?? null });
    for (const d of windowDaysSeen) days.add(d);
    if (!windowDaysSeen.length) { stoppedBecause = 'no older data'; break; }
    // A window whose first session is well after its start means the data begins inside it: there is nothing older to find.
    if (windowDaysSeen[0] > addDays(from, 10)) { stoppedBecause = 'no older data'; break; }
    end = addDays(from, -1);
  }

  const sorted = [...days].sort();
  // A month is usable for the anchored VWAP only if its first real session is in the data.
  const monthsFullyCovered = [...new Set(sorted.map((d) => d.slice(0, 7)))].filter((month) => (sorted.find((d) => d.startsWith(month)) ?? '9') <= expectedFirstSession(month));
  return { symbol, earliestDay: sorted[0] ?? null, sessionsSeen: sorted.length, windows, stoppedBecause, error, monthsFullyCovered };
}
