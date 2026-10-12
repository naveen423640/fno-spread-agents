// The agent loop. `agentStep` handles one recorded minute of one underlying: it manages open trades first, then judges new signals and journals
// every one of them (taken or skipped) at decision time. It reads only snapshots up to the minute it is given, so the live runner (one call per
// recorded minute) and replay (one call per stored minute) are the same code and give the same journal. Paper trading only. No orders exist here.
import { analyzeSession, type SessionAnalysis, type UsableAnalysis } from '@/lib/ltp/analyze';
import { ivMove, type ExtensionMethod } from '@/lib/ltp/extensions';
import { weeklyFor } from '@/lib/ltp/state';
import type { LtpStore } from '@/lib/ltp/store';
import { istDate, istHhmm } from '@/lib/ltp/time';
import type { Snapshot } from '@/lib/ltp/types';
import { closePosition, markPosition, openPosition, resolveExit, type Book, type Direction, type ExitReason, type Position } from './books';
import type { AgentJournal, DecisionRecord, TradeRow } from './journal-store';
import { reasonText } from './reason';
import { evaluate, type Candidate } from './signals';
import type { Strategy } from './strategy';

// `analysisCache` lets two strategies replayed over the same days share the engine work (the analysis does not depend on the strategy).
export type AgentContext = { store: LtpStore; journal: AgentJournal; strategy: Strategy; paused: boolean; method?: ExtensionMethod; analysisCache?: Map<string, SessionAnalysis> };
export type StepResult = { decisions: number; opened: number; closed: number };
type StoredTrade = { position: Position; plan: { stop: number; target: number; direction: Direction }; entryLevels: { support: number; resistance: number } };

const round2 = (x: number) => Math.round(x * 100) / 100;
export const decisionIdOf = (underlying: string, ts: number, setup: string, direction: string, version: string) => `${underlying}|${ts}|${setup}|${direction}|${version}`;

async function manageOpen(ctx: AgentContext, underlying: string, date: string, cur: Snapshot, prev: Snapshot | null, analysis: UsableAnalysis | null, forced: ExitReason | null): Promise<number> {
  const rows: TradeRow[] = await ctx.journal.openTrades(underlying, date);
  const gap = prev !== null && cur.ts - prev.ts > 60;
  const timeUp = istHhmm(cur.ts) >= ctx.strategy.time_exit;
  let closed = 0;
  for (const row of rows) {
    const stored = row.position as StoredTrade;
    const marked = markPosition(stored.position, cur);
    const shifted = ctx.strategy.exit_on_level_shift && analysis !== null && (stored.plan.direction === 'long' ? analysis.levels.support.strike !== stored.entryLevels.support : analysis.levels.resistance.strike !== stored.entryLevels.resistance);
    const reason: ExitReason | null = forced ?? (gap ? 'data_gap' : resolveExit(prev?.spot ?? null, cur.spot, stored.plan) ?? (timeUp ? 'time' : shifted ? 'level_shift' : null));
    if (reason) {
      await ctx.journal.recordOutcome(row.decisionId, row.book, closePosition(marked, cur, reason, ctx.strategy));
      closed += 1;
    } else {
      await ctx.journal.updateTradePosition(row.decisionId, row.book, { ...stored, position: marked });
    }
  }
  return closed;
}

async function contextOf(ctx: AgentContext, a: UsableAnalysis, c: Candidate, snaps: Snapshot[], date: string) {
  const { weekly } = await weeklyFor(ctx.store, a.underlying, a.expiry, { save: false }); // computed, never written: replay opens the snapshot database read-only
  const last = a.events.length ? a.events[a.events.length - 1] : null;
  const side = (s: UsableAnalysis['strength']['support'], decidedBy: string) => ({ strike: s.strike, status: s.status, volumePct: s.pct.volume, oiPct: s.pct.oi, decidedBy });
  const lines = a.lines0920;
  return {
    spot: a.spot, line: a.levels.line, support: side(a.strength.support, a.levels.support.decidedBy), resistance: side(a.strength.resistance, a.levels.resistance.decidedBy),
    scenario: a.coa1.scenario.number, scenarioBias: a.coa1.scenario.bias, directions: { support: a.direction.support.current, resistance: a.direction.resistance.current, banner: a.direction.banner.kind },
    coa2: { callTrend: a.coa2.callTrend, putTrend: a.coa2.putTrend, result: a.coa2.result }, soc: a.soc ? { type: a.soc.type, bias: a.soc.bias, side: a.soc.side, minutes: a.soc.minutes } : null,
    diversions: a.diversions.count,
    lines0920: lines ? { snapshotTs: lines.snapshotTs, short: { risky: lines.short.risky.value, moderate: lines.short.moderate.value, maxPain: lines.short.maxPain.value, maxGain: lines.short.maxGain.value }, long: { risky: lines.long.risky.value, moderate: lines.long.moderate.value, maxPain: lines.long.maxPain.value, maxGain: lines.long.maxGain.value } } : null,
    weekly: weekly ? { s: weekly.s, l1: weekly.l1, l2: weekly.l2, l3: weekly.l3, lateStart: weekly.lateStart, spotMultiple: round2((a.spot - weekly.cmp) / weekly.s) } : null,
    hit: c.hit, minutesSinceShift: last ? (a.asOf - last.ts) / 60 : null, hhmm: istHhmm(a.asOf),
    daysToExpiry: Math.round((Date.parse(a.expiry) - Date.parse(date)) / 86_400_000), method: a.method.id, snapshots: snaps.length,
  };
}

export async function agentStep(ctx: AgentContext, underlying: string, ts: number): Promise<StepResult> {
  const date = istDate(ts);
  const snaps = (await ctx.store.snapshotsForDay(underlying, date)).filter((s) => s.ts <= ts);
  const cur = snaps[snaps.length - 1];
  if (!cur || cur.ts !== ts) return { decisions: 0, opened: 0, closed: 0 };
  const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  const method = ctx.method ?? ivMove;
  const cacheKey = `${underlying}|${ts}|${method.id}`;
  const result = ctx.analysisCache?.get(cacheKey) ?? analyzeSession(snaps, { now: ts, method });
  ctx.analysisCache?.set(cacheKey, result);
  const analysis = !result.empty && result.usable ? result : null;

  const closed = await manageOpen(ctx, underlying, date, cur, prev, analysis, null);
  if (ctx.paused || !analysis) return { decisions: 0, opened: 0, closed };

  const todays = await ctx.journal.decisionsForDay(date, underlying);
  const open = await ctx.journal.openTrades(underlying, date);
  const byBook = { buy: 0, sell: 0 };
  for (const o of await ctx.journal.outcomesForDay(date)) byBook[o.book] += o.netPnl;
  const counts = { dayTradeCount: todays.filter((d) => d.taken).length, openCount: new Set(open.map((o) => o.decisionId)).size, dayLossInr: Math.max(0, -Math.min(byBook.buy, byBook.sell)) };
  const gaps = snaps.slice(1).filter((s, i) => s.ts - snaps[i].ts > 60).length;

  let decisions = 0;
  let opened = 0;
  for (let i = 0; ; i += 1) {
    const candidate = evaluate(analysis, ctx.strategy, counts)[i];
    if (!candidate) break;
    const id = decisionIdOf(underlying, ts, candidate.setup, candidate.direction, ctx.strategy.version);
    if (await ctx.journal.decisionById(id)) continue; // this minute was already judged
    let c = candidate;
    const signal = { direction: c.direction, underlying, anchorStrike: c.anchorStrike };
    const books: Partial<Record<Book, Position>> = {};
    const bookSkips: Record<string, string> = {};
    if (c.taken) {
      for (const book of ['buy', 'sell'] as Book[]) {
        const p = openPosition(book, signal, cur, ctx.strategy, date);
        if ('skipped' in p) bookSkips[book] = p.skipped; else books[book] = p;
      }
      // If no book could be opened (no usable quote), the signal was not tradable: say so in the trace, as the first failing rule.
      if (!books.buy && !books.sell) c = { ...c, taken: false, skipReason: 'book_quote', trace: [...c.trace, { rule: 'book_quote', inputs: { buy: bookSkips.buy ?? null, sell: bookSkips.sell ?? null }, passed: false }] };
    }
    const record: DecisionRecord = {
      decisionId: id, ts, tradeDate: date, underlying, strategyVersion: ctx.strategy.version, setup: c.setup, direction: c.direction, book: 'both', taken: c.taken, skipReason: c.skipReason,
      context: await contextOf(ctx, analysis, c, snaps, date), trace: c.trace, reason: reasonText(c, analysis),
      expectation: {
        entry: c.entry, stop: c.stop, target: c.target, plannedRiskPts: c.plannedRiskPts, rewardPts: c.rewardPts, rr: c.plannedRiskPts && c.rewardPts ? round2(c.rewardPts / c.plannedRiskPts) : null, level: c.level,
        perBook: { buy: books.buy ? { plannedRiskInr: books.buy.plannedRiskInr, fillQuality: books.buy.fillQuality } : { skipped: bookSkips.buy ?? null }, sell: books.sell ? { plannedRiskInr: books.sell.plannedRiskInr, marginEstimate: books.sell.marginEstimate, fillQuality: books.sell.fillQuality } : { skipped: bookSkips.sell ?? null } },
      },
      dataQuality: { snapshotAgeSeconds: ts - cur.ts, fetchLatencyMs: cur.fetchLatencyMs, historyFrom: istHhmm(snaps[0].ts), gaps, bookSkips },
    };
    await ctx.journal.recordDecision(record);
    decisions += 1;
    if (c.taken) {
      for (const book of ['buy', 'sell'] as Book[]) {
        const position = books[book];
        if (!position) continue;
        const stored: StoredTrade = { position, plan: { stop: c.stop!, target: c.target!, direction: c.direction }, entryLevels: { support: analysis.levels.support.strike, resistance: analysis.levels.resistance.strike } };
        await ctx.journal.recordTrade({ decisionId: id, book, status: 'open', openedTs: ts, position: stored });
        opened += 1;
      }
      counts.dayTradeCount += 1;
      counts.openCount += 1;
    }
  }
  return { decisions, opened, closed };
}

// Closes anything still open at the last snapshot of the day (the recorder stopped, or the market closed) and flags it as a data gap.
export async function finishDay(ctx: AgentContext, underlying: string, date: string): Promise<number> {
  const snaps = await ctx.store.snapshotsForDay(underlying, date);
  const cur = snaps[snaps.length - 1];
  if (!cur) return 0;
  return manageOpen(ctx, underlying, date, cur, snaps.length > 1 ? snaps[snaps.length - 2] : null, null, 'data_gap');
}

export async function agentReplayDay(ctx: AgentContext, underlying: string, date: string): Promise<void> {
  for (const snap of await ctx.store.snapshotsForDay(underlying, date)) await agentStep(ctx, underlying, snap.ts);
  await finishDay(ctx, underlying, date);
}
