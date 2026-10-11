import { mean, stdev } from './stats';
import type { PricedTrade } from './pricing';

export type Summary = {
  trades: number; wins: number; winRate: number | null;
  avgWinRs: number | null; avgLossRs: number | null;
  expectancyRs: number | null; expectancyPct: number | null; // per trade, after costs
  profitFactor: number | null; totalPnl: number; grossPnl: number; totalCosts: number;
  maxDrawdown: number; sharpeDaily: number | null; avgHoldMinutes: number | null; avgMaePct: number | null; avgMfePct: number | null;
};

export function computeSummary(trades: PricedTrade[], allDays: string[]): Summary {
  const n = trades.length;
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl < 0);
  const winSum = wins.reduce((a, t) => a + t.netPnl, 0);
  const lossSum = losses.reduce((a, t) => a + t.netPnl, 0);

  // Max drawdown on the running net P&L, in the order trades were closed.
  let equity = 0, peak = 0, drawdown = 0;
  for (const t of [...trades].sort((a, b) => a.exitT - b.exitT)) { equity += t.netPnl; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak - equity); }

  // Daily Sharpe: net P&L per trading day (zero on days with no trade), annualised with the square root of 252.
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.netPnl);
  const daily = allDays.map((d) => byDay.get(d) ?? 0);
  const sd = stdev(daily);
  return {
    trades: n, wins: wins.length, winRate: n ? wins.length / n : null,
    avgWinRs: wins.length ? winSum / wins.length : null, avgLossRs: losses.length ? lossSum / losses.length : null,
    expectancyRs: n ? mean(trades.map((t) => t.netPnl)) : null, expectancyPct: n ? mean(trades.map((t) => t.netPct)) : null,
    profitFactor: lossSum < 0 ? winSum / -lossSum : null,
    totalPnl: trades.reduce((a, t) => a + t.netPnl, 0), grossPnl: trades.reduce((a, t) => a + t.grossPnl, 0), totalCosts: trades.reduce((a, t) => a + t.costs.total, 0),
    maxDrawdown: drawdown, sharpeDaily: daily.length > 2 && sd > 0 ? (mean(daily) / sd) * Math.sqrt(252) : null,
    avgHoldMinutes: n ? mean(trades.map((t) => t.holdMinutes)) : null, avgMaePct: n ? mean(trades.map((t) => t.maePct)) : null, avgMfePct: n ? mean(trades.map((t) => t.mfePct)) : null,
  };
}

export function equityCurve(trades: PricedTrade[]): { t: number; equity: number }[] {
  let equity = 0;
  return [...trades].sort((a, b) => a.exitT - b.exitT).map((t) => ({ t: t.exitT, equity: (equity += t.netPnl) }));
}

export function distribution(trades: PricedTrade[], bins = 12): { edges: number[]; counts: number[] } {
  if (!trades.length) return { edges: [], counts: [] };
  const values = trades.map((t) => t.netPct);
  const low = Math.min(...values), high = Math.max(...values);
  const width = (high - low) / bins || 1;
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - low) / width))] += 1;
  return { edges: Array.from({ length: bins + 1 }, (_, i) => low + i * width), counts };
}

export type SliceRow = { key: string; trades: number; winRate: number | null; expectancyPct: number | null; expectancyRs: number | null; totalPnl: number };

// The same summary figures split by any key (direction, signal type, time of day, day of month, sector, symbol...).
export function sliceBy(trades: PricedTrade[], key: (t: PricedTrade) => string): SliceRow[] {
  const groups = new Map<string, PricedTrade[]>();
  for (const t of trades) { const k = key(t); groups.set(k, [...(groups.get(k) ?? []), t]); }
  return [...groups.entries()].map(([k, g]) => ({
    key: k, trades: g.length, winRate: g.filter((t) => t.netPnl > 0).length / g.length, expectancyPct: mean(g.map((t) => t.netPct)), expectancyRs: mean(g.map((t) => t.netPnl)), totalPnl: g.reduce((a, t) => a + t.netPnl, 0),
  })).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

const istMinutes = (t: number) => { const d = new Date((t + 19_800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const timeBucket = (t: number) => { const m = istMinutes(t); const b = Math.floor(m / 30) * 30; return `${String(Math.floor(b / 60)).padStart(2, '0')}:${String(b % 60).padStart(2, '0')}`; };
export const dayOfMonthBucket = (day: string) => { const d = Number(day.slice(8, 10)); return d <= 5 ? '1-5' : d <= 10 ? '6-10' : d <= 15 ? '11-15' : d <= 20 ? '16-20' : d <= 25 ? '21-25' : '26-31'; };

export const SLICES: Record<string, (t: PricedTrade) => string> = {
  direction: (t) => (t.direction === 1 ? 'long (up cross)' : 'short (down cross)'),
  signalType: (t) => String(t.signalType),
  borderline: (t) => (t.borderline ? 'borderline' : 'clean'),
  timeOfDay: (t) => timeBucket(t.entryT),
  dayOfMonth: (t) => dayOfMonthBucket(t.day),
  sector: (t) => t.sector,
  symbol: (t) => t.ticker,
};

// Entry time of day (30-minute buckets) against day of month (5-day buckets): trades and mean net percent in each cell.
export function heatmap(trades: PricedTrade[]): { rows: string[]; cols: string[]; cells: Record<string, { n: number; meanPct: number }> } {
  const rows = [...new Set(trades.map((t) => timeBucket(t.entryT)))].sort();
  const cols = ['1-5', '6-10', '11-15', '16-20', '21-25', '26-31'].filter((c) => trades.some((t) => dayOfMonthBucket(t.day) === c));
  const cells: Record<string, { n: number; meanPct: number }> = {};
  for (const r of rows) for (const c of cols) {
    const g = trades.filter((t) => timeBucket(t.entryT) === r && dayOfMonthBucket(t.day) === c);
    if (g.length) cells[`${r}|${c}`] = { n: g.length, meanPct: mean(g.map((t) => t.netPct)) };
  }
  return { rows, cols, cells };
}
