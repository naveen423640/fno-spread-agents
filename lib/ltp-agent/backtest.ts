// A backtest: the agent replayed over recorded days into a throwaway in-memory journal, so nothing is written to the live journal or the snapshot
// store. It shows what the agent WOULD have traded and why. It is not evidence of an edge: a few days prove nothing, and the recorded days may start
// late and have gaps (see `notes`).
import type { ExtensionMethod } from '@/lib/ltp/extensions';
import type { SessionAnalysis } from '@/lib/ltp/analyze';
import type { LtpStore } from '@/lib/ltp/store';
import { istHhmm } from '@/lib/ltp/time';
import { UNDERLYINGS } from '@/lib/ltp/recorder';
import { agentReplayDay } from './agent';
import type { Book } from './books';
import { createMemoryJournal } from './memory-journal';
import { metricsOf } from './metrics';
import { closedBookView, tradeView, type SkippedSignal, type TodayTrade } from './state';
import type { Strategy } from './strategy';

export type BacktestResult = {
  version: string; label: string; days: string[]; notes: string[];
  summary: { decisions: number; taken: number; skipped: number; closedTrades: number; byBook: Record<Book, { n: number; net: number; winRate: number }> };
  skipCounts: Record<string, number>; trades: TodayTrade[]; skipped: SkippedSignal[];
};

export async function runBacktest(deps: { store: LtpStore; strategy: Strategy; days: string[]; underlyings?: string[]; method?: ExtensionMethod; cache?: Map<string, SessionAnalysis>; label?: string }): Promise<BacktestResult> {
  const days = [...new Set(deps.days)].sort();
  const underlyings = deps.underlyings ?? UNDERLYINGS;
  const journal = createMemoryJournal();
  const cache = deps.cache ?? new Map<string, SessionAnalysis>(); // the engine work does not depend on the strategy, so a comparison run shares it
  const ctx = { store: deps.store, journal, strategy: deps.strategy, paused: false, method: deps.method, analysisCache: cache };
  const notes: string[] = [];
  const trades: TodayTrade[] = [];
  const skipped: SkippedSignal[] = [];
  const skipCounts: Record<string, number> = {};
  const nets: Record<Book, number[]> = { buy: [], sell: [] };
  let decisionsTotal = 0;
  let taken = 0;

  for (const day of days) {
    for (const u of underlyings) {
      const first = (await deps.store.snapshotsForDay(u, day))[0];
      if (first && istHhmm(first.ts) > '09:20') notes.push(`${day} ${u.split(':')[1]}: the recorded history starts at ${istHhmm(first.ts)}, so the 9:20 lines and the side directions are not the real tool's for that day.`);
      await agentReplayDay(ctx, u, day);
    }
    const decisions = await journal.decisionsForDay(day);
    const outcomes = await journal.outcomesForDay(day);
    for (const d of decisions) {
      decisionsTotal += 1;
      if (!d.taken) { skipped.push({ decisionId: d.decisionId, ts: d.ts, underlying: d.underlying, setup: d.setup, direction: d.direction, skipReason: d.skipReason ?? '', reason: d.reason }); skipCounts[d.skipReason ?? 'unknown'] = (skipCounts[d.skipReason ?? 'unknown'] ?? 0) + 1; continue; }
      taken += 1;
      const books: TodayTrade['books'] = {};
      for (const o of outcomes.filter((x) => x.decisionId === d.decisionId)) { books[o.book] = closedBookView(o); nets[o.book].push(o.netPnl); }
      if (Object.keys(books).length) trades.push(tradeView(d, books));
    }
  }
  trades.sort((a, b) => a.ts - b.ts);
  const gapTrades = trades.filter((t) => Object.values(t.books).some((b) => b?.exitReason === 'data_gap')).length;
  if (gapTrades) notes.push(`${gapTrades} trade(s) were closed as a data gap (the recorder skipped minutes, or the recorded day ended with the trade open), so their results are not real exits.`);
  if (trades.some((t) => Object.values(t.books).some((b) => b?.fillQuality === 'ltp_fallback'))) notes.push('Some fills used LTP plus slippage because no bid or ask was recorded at that time (recording of quotes began on 2026-10-12 during the session).');
  const book = (b: Book) => { const m = metricsOf(nets[b]); return { n: m.n, net: m.netPnl, winRate: m.winRate }; };
  return {
    version: deps.strategy.version, label: deps.label ?? `v${deps.strategy.version}`, days, notes,
    summary: { decisions: decisionsTotal, taken, skipped: decisionsTotal - taken, closedTrades: trades.length, byBook: { buy: book('buy'), sell: book('sell') } },
    skipCounts, trades, skipped,
  };
}
