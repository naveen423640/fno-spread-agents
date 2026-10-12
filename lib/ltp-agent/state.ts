// Everything the Agent tab shows, built from the journal and the snapshot store only (never FYERS).
import { analyzeSession } from '@/lib/ltp/analyze';
import { health, UNDERLYINGS, type Health } from '@/lib/ltp/recorder';
import type { LtpStore } from '@/lib/ltp/store';
import { istDate } from '@/lib/ltp/time';
import { dayCounts } from './agent';
import { watchLevels } from './signals';
import type { Book, ClosedTrade, ExitReason, Position } from './books';
import type { FillQuality } from './fills';
import type { JournalStore, OutcomeRow } from './journal-store';
import { phaseOf } from './phase';
import { summarizeTrades, summaryTradeOf, type WeeklySummary } from './reviewer';
import { loadActiveStrategy } from './strategy-store';
import { equityCurve, heartbeatBadge, mtmOf } from './view';

export type BookToday = { status: 'open' | 'closed'; fillQuality: FillQuality; plannedRiskInr: number; marginEstimate?: number; mtm?: number; netPnl?: number; exitReason?: ExitReason };
export type TodayTrade = { decisionId: string; ts: number; underlying: string; setup: string; direction: string; reason: string; entry: number | null; stop: number | null; target: number | null; plannedRiskPts: number | null; rewardPts: number | null; books: Partial<Record<Book, BookToday>> };
export type SkippedSignal = { decisionId: string; ts: number; underlying: string; setup: string; direction: string; skipReason: string; reason: string };
export type EquityPoint = { ts: number; equity: number };
// One level the agent is watching: where it would enter, with the plan and whether it would trade there now (and if not, what stops it).
export type WatchLevel = { setup: string; direction: string; label: string; value: number; distance: number; entry: number; stop: number | null; target: number | null; plannedRiskPts: number | null; rewardPts: number | null; hit: number; wouldTrade: boolean; blockedBy: string | null };
export type WatchRow = { underlying: string; date: string; asOf: number; spot: number; scenario: number; scenarioBias: string; banner: string; levels: WatchLevel[] };
export type AgentState = {
  watch: WatchRow[];
  header: { activeVersion: string; phase: ReturnType<typeof phaseOf>; closedTrades: number; paused: boolean; heartbeatAgeSeconds: number | null; heartbeat: 'green' | 'amber' | 'red'; recorder: Pick<Health, 'badge' | 'lastSuccessTs' | 'gapsToday' | 'recordingNow'> };
  today: { date: string; open: TodayTrade[]; closed: TodayTrade[]; skipped: SkippedSignal[] };
  performance: {
    equity: Record<Book, EquityPoint[]>; byVersion: Record<string, Record<Book, EquityPoint[]>>; buyVsSell: WeeklySummary['byBook']; breakdowns: WeeklySummary;
  };
  experimentsLocked: boolean;
};

const num = (v: unknown) => (typeof v === 'number' ? v : null);

export async function buildAgentState(deps: { store: LtpStore; journal: JournalStore; holidays: ReadonlySet<string> }, opts: { date?: string; nowTs: number }): Promise<AgentState> {
  const { store, journal } = deps;
  const date = opts.date ?? istDate(opts.nowTs);
  const strategy = await loadActiveStrategy(journal);
  const closedTrades = await journal.closedTradeCount(strategy.version);
  const phase = phaseOf(closedTrades);
  const heartbeatRaw = await journal.getState('heartbeat_ts');
  const heartbeatAgeSeconds = heartbeatRaw === null ? null : Math.max(0, opts.nowTs - Number(heartbeatRaw));
  const recorder = await health(store, opts.nowTs, UNDERLYINGS, deps.holidays);

  const decisions = await journal.decisionsForDay(date);
  const open = new Map<string, Partial<Record<Book, Position>>>();
  for (const u of UNDERLYINGS) for (const row of await journal.openTrades(u, date)) open.set(row.decisionId, { ...open.get(row.decisionId), [row.book]: (row.position as { position: Position }).position });
  const outcomes = new Map<string, Partial<Record<Book, OutcomeRow>>>();
  for (const o of await journal.outcomesForDay(date)) outcomes.set(o.decisionId, { ...outcomes.get(o.decisionId), [o.book]: o });

  const today: AgentState['today'] = { date, open: [], closed: [], skipped: [] };
  for (const d of decisions) {
    if (!d.taken) { today.skipped.push({ decisionId: d.decisionId, ts: d.ts, underlying: d.underlying, setup: d.setup, direction: d.direction, skipReason: d.skipReason ?? '', reason: d.reason }); continue; }
    const e = d.expectation as Record<string, unknown>;
    const books: TodayTrade['books'] = {};
    for (const [book, p] of Object.entries(open.get(d.decisionId) ?? {}) as [Book, Position][]) books[book] = { status: 'open', fillQuality: p.fillQuality, plannedRiskInr: p.plannedRiskInr, mtm: mtmOf(p), ...(p.marginEstimate ? { marginEstimate: p.marginEstimate.inr } : {}) };
    for (const [book, o] of Object.entries(outcomes.get(d.decisionId) ?? {}) as [Book, OutcomeRow][]) {
      const t: ClosedTrade = o.outcome;
      books[book] = { status: 'closed', fillQuality: t.fillQuality, plannedRiskInr: t.plannedRiskInr, netPnl: t.netPnl, exitReason: t.exitReason, ...(t.marginEstimate ? { marginEstimate: t.marginEstimate.inr } : {}) };
    }
    if (!Object.keys(books).length) continue;
    const trade: TodayTrade = { decisionId: d.decisionId, ts: d.ts, underlying: d.underlying, setup: d.setup, direction: d.direction, reason: d.reason, entry: num(e.entry), stop: num(e.stop), target: num(e.target), plannedRiskPts: num(e.plannedRiskPts), rewardPts: num(e.rewardPts), books };
    (Object.values(books).some((b) => b.status === 'open') ? today.open : today.closed).push(trade);
  }

  const watch: WatchRow[] = [];
  for (const u of UNDERLYINGS) {
    const day = (await store.countForDay(u, date)) > 0 ? date : await store.latestDate(u);
    if (!day) continue;
    const snaps = await store.snapshotsForDay(u, day);
    const last = snaps[snaps.length - 1];
    const analysis = last ? analyzeSession(snaps, { now: last.ts }) : null;
    if (!analysis || analysis.empty || !analysis.usable) continue;
    const levels = watchLevels(analysis, strategy, await dayCounts(journal, u, day)).map((c) => ({
      setup: c.setup, direction: c.direction, label: c.level.label, value: c.level.value, distance: c.level.value - analysis.spot, entry: c.entry, stop: c.stop, target: c.target,
      plannedRiskPts: c.plannedRiskPts, rewardPts: c.rewardPts, hit: c.hit, wouldTrade: c.taken, blockedBy: c.skipReason,
    })).sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance));
    watch.push({ underlying: u, date: day, asOf: last.ts, spot: analysis.spot, scenario: analysis.coa1.scenario.number, scenarioBias: analysis.coa1.scenario.bias, banner: analysis.direction.banner.text, levels });
  }

  const records = await journal.closedTrades();
  const curve = (rows: ClosedTradeRecordLike[], book: Book) => equityCurve(rows.flatMap((r) => r.outcomes.filter((o) => o.book === book).map((o) => ({ ts: o.closedTs, net: o.netPnl }))));
  const byVersion: Record<string, Record<Book, EquityPoint[]>> = {};
  for (const version of [...new Set(records.map((r) => r.decision.strategyVersion))].sort()) {
    const rows = records.filter((r) => r.decision.strategyVersion === version);
    byVersion[version] = { buy: curve(rows, 'buy'), sell: curve(rows, 'sell') };
  }
  const breakdowns = summarizeTrades(records.map(summaryTradeOf));
  return {
    watch,
    header: { activeVersion: strategy.version, phase, closedTrades, paused: (await journal.getState('paused')) === 'true', heartbeatAgeSeconds, heartbeat: heartbeatBadge(heartbeatAgeSeconds), recorder: { badge: recorder.badge, lastSuccessTs: recorder.lastSuccessTs, gapsToday: recorder.gapsToday, recordingNow: recorder.recordingNow } },
    today,
    performance: { equity: { buy: curve(records, 'buy'), sell: curve(records, 'sell') }, byVersion, buyVsSell: breakdowns.byBook, breakdowns },
    experimentsLocked: !phase.unlocked,
  };
}

type ClosedTradeRecordLike = { outcomes: OutcomeRow[] };
