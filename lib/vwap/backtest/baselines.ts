import { signalsForDay, simulateDay } from './engine';
import { mean } from './stats';
import { priceTrade, type PricedTrade, type PricingContext } from './pricing';
import { DEFAULT_FILTERS, type ExitRule, type ForcedEntry } from './types';
import { foldDay, type C5, type CrossEvent, type PriorTotals } from '../core';
import { rng } from './stats';

// A symbol-day ready to simulate: its candles, the month totals before it, and the cross event on each candle (computed once).
export type PreparedDay = { symbol: string; sector: string; month: string; day: string; sessionOfMonth: number; candles: C5[]; prior: PriorTotals; events: (CrossEvent | null)[] };

export function prepareMonth(symbol: string, sector: string, month: string, days: Map<string, C5[]>): PreparedDay[] {
  const out: PreparedDay[] = [];
  let prior: PriorTotals = { sumPv: 0, sumV: 0, lastClose: null, lastVwap: null };
  let session = 0;
  for (const day of [...days.keys()].sort()) {
    const candles = [...days.get(day)!].sort((a, b) => a.t - b.t);
    session += 1;
    out.push({ symbol, sector, month, day, sessionOfMonth: session, candles, prior, events: signalsForDay(prior, candles) });
    prior = foldDay(prior, candles);
  }
  return out;
}

export type BaselineStats = { n: number; meanNetPct: number | null; winRate: number | null; note?: string };
const stats = (trades: PricedTrade[], note?: string): BaselineStats => ({ n: trades.length, meanNetPct: trades.length ? mean(trades.map((t) => t.netPct)) : null, winRate: trades.length ? trades.filter((t) => t.netPnl > 0).length / trades.length : null, note });

const asInput = (d: PreparedDay) => ({ day: d.day, month: d.month, sessionOfMonth: d.sessionOfMonth, symbol: d.symbol, sector: d.sector, candles: d.candles, prior: d.prior });

function runForced(d: PreparedDay, rule: ExitRule, forced: ForcedEntry[], ctx: PricingContext, label: string): PricedTrade[] {
  return simulateDay(asInput(d), rule, { ...DEFAULT_FILTERS, entryFrom: '09:15', entryTo: '23:59' }, forced)
    .map((t) => priceTrade({ ...t, signalType: 'baseline', strategy: label }, ctx)).filter((t): t is PricedTrade => t !== null);
}

// Baseline 1: random entries at the same times and counts per day as the strategy, in random symbols and directions, with the same exit rule.
// Returns the mean net percent per trade of each random run, so the strategy can be placed inside that spread.
export function randomEntryBaseline(prepared: PreparedDay[], strategyTrades: PricedTrade[], rule: ExitRule, ctx: PricingContext, runs: number, seed: number): { runMeans: number[]; tradesPerRun: number } {
  const byDay = new Map<string, PreparedDay[]>();
  for (const d of prepared) byDay.set(d.day, [...(byDay.get(d.day) ?? []), d]);
  const entriesByDay = new Map<string, number[]>();
  for (const t of strategyTrades) {
    const pool = byDay.get(t.day);
    if (!pool?.length) continue;
    const index = Math.round((t.entryT - pool[0].candles[0].t) / 300);
    entriesByDay.set(t.day, [...(entriesByDay.get(t.day) ?? []), index]);
  }
  const rand = rng(seed);
  const runMeans: number[] = [];
  let count = 0;
  for (let r = 0; r < runs; r += 1) {
    const results: PricedTrade[] = [];
    for (const [day, indices] of entriesByDay) {
      const pool = byDay.get(day)!;
      // Each symbol holds one position at a time, so entries on the same day go to distinct symbols while there are enough of them.
      const free = [...pool];
      for (const index of indices) {
        if (!free.length) break;
        const d = free.splice(Math.floor(rand() * free.length), 1)[0];
        results.push(...runForced(d, rule, [{ index, direction: rand() < 0.5 ? 1 : -1 }], ctx, 'random'));
      }
    }
    count = results.length;
    if (results.length) runMeans.push(mean(results.map((t) => t.netPct)));
  }
  return { runMeans, tradesPerRun: count };
}

// Baseline 2: buy (and, separately, sell) every symbol at the 09:30 open and hold to the square-off.
export function openToCloseBaseline(prepared: PreparedDay[], squareoffAt: string, ctx: PricingContext, entryIndex = 3): { long: BaselineStats; short: BaselineStats; both: BaselineStats } {
  const rule: ExitRule = { name: 'open-to-close', squareoffAt };
  const long: PricedTrade[] = [], short: PricedTrade[] = [];
  for (const d of prepared) {
    if (d.candles.length <= entryIndex) continue;
    long.push(...runForced(d, rule, [{ index: entryIndex, direction: 1 }], ctx, 'open-long'));
    short.push(...runForced(d, rule, [{ index: entryIndex, direction: -1 }], ctx, 'open-short'));
  }
  return { long: stats(long), short: stats(short), both: stats([...long, ...short]) };
}

// Baseline 3: at 09:30 buy the day's top gainers and sell its top losers (against the previous session's close) and hold to the square-off.
export function gainersLosersBaseline(prepared: PreparedDay[], topN: number, squareoffAt: string, ctx: PricingContext, entryIndex = 3): BaselineStats {
  const rule: ExitRule = { name: 'gainers-losers', squareoffAt };
  const bySymbol = new Map<string, PreparedDay[]>();
  for (const d of prepared) bySymbol.set(d.symbol, [...(bySymbol.get(d.symbol) ?? []), d].sort((a, b) => a.day.localeCompare(b.day)));
  const days = new Map<string, { d: PreparedDay; change: number }[]>();
  for (const list of bySymbol.values()) {
    list.forEach((d, i) => {
      const previous = d.prior.lastClose ?? (i > 0 ? list[i - 1].candles[list[i - 1].candles.length - 1].c : null);
      if (previous === null || d.candles.length <= entryIndex) return;
      days.set(d.day, [...(days.get(d.day) ?? []), { d, change: d.candles[entryIndex].o / previous - 1 }]);
    });
  }
  const trades: PricedTrade[] = [];
  for (const group of days.values()) {
    if (group.length < 2 * topN) continue;
    const ranked = [...group].sort((a, b) => b.change - a.change);
    for (const g of ranked.slice(0, topN)) trades.push(...runForced(g.d, rule, [{ index: entryIndex, direction: 1 }], ctx, 'gainer'));
    for (const g of ranked.slice(-topN)) trades.push(...runForced(g.d, rule, [{ index: entryIndex, direction: -1 }], ctx, 'loser'));
  }
  return stats(trades, group0(topN));
}
const group0 = (n: number) => `momentum: top ${n} gainers bought and top ${n} losers sold at 09:30`;
