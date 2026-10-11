// Event-driven simulation on closed 5-minute candles. Walks each day candle by candle. At each closed candle the VWAP and cross events
// come from scanSymbol over the candles up to that candle only, so nothing later can influence a signal or an entry. A signal on candle i
// enters at the OPEN of candle i + 1. The same signals feed every exit rule.
import { foldDay, istDayOf, istTime, scanSymbol, type C5, type CrossEvent, type PriorTotals } from '../core';
import { DEFAULT_FILTERS, type ExitReason, type ExitRule, type ForcedEntry, type RawTrade, type SignalFilters } from './types';

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const candleMinutes = (t: number) => minutesOf(istTime(t));

// The cross event (if any) on each candle, using only candles up to and including it.
export function signalsForDay(prior: PriorTotals, candles: C5[]): (CrossEvent | null)[] {
  const sorted = [...candles].sort((a, b) => a.t - b.t);
  return sorted.map((c, i) => scanSymbol(prior, sorted.slice(0, i + 1)).events.find((e) => e.t === c.t) ?? null);
}

export type DayInput = { day: string; month: string; sessionOfMonth: number; symbol: string; sector: string; candles: C5[]; prior: PriorTotals };

function passes(event: CrossEvent, filters: SignalFilters, eventsSeen: number, candleIndex: number, candles: C5[]): boolean {
  if (!filters.types.includes(event.type)) return false;
  if (!filters.directions.includes(event.direction)) return false;
  if (filters.firstCrossOnly && eventsSeen !== 1) return false;
  if (filters.skipBorderline && event.borderline) return false;
  if (Math.abs(event.distancePct) < filters.minDistancePct) return false;
  if (filters.minAvgCandleVolume > 0) {
    const sofar = candles.slice(0, candleIndex + 1).reduce((a, c) => a + c.v, 0) / (candleIndex + 1);
    if (sofar < filters.minAvgCandleVolume) return false;
  }
  return true;
}

// Simulates one rule over one day. Entries come from VWAP signals, or from `forced` (used by the random-entry baseline).
export function simulateDay(input: DayInput, rule: ExitRule, filters: SignalFilters = DEFAULT_FILTERS, forced?: ForcedEntry[], precomputed?: (CrossEvent | null)[]): RawTrade[] {
  const candles = [...input.candles].sort((a, b) => a.t - b.t);
  const events = forced ? [] : (precomputed ?? signalsForDay(input.prior, candles));
  const squareoff = rule.squareoffAt ? minutesOf(rule.squareoffAt) : null;
  const entryFrom = minutesOf(filters.entryFrom);
  const entryTo = minutesOf(filters.entryTo);
  const trades: RawTrade[] = [];

  type Pos = { dir: 1 | -1; entryIdx: number; entry: number; stop: number | null; target: number | null; peak: number; trail: number | null; mae: number; mfe: number; signal: CrossEvent | null };
  let pos: Pos | null = null;
  let pendingEntry: { event: CrossEvent | null; direction: 1 | -1 } | null = null;
  let pendingExit = false;
  let eventsSeen = 0;

  const close = (exitIdx: number, price: number, reason: ExitReason) => {
    const p = pos!;
    const entryCandle = candles[p.entryIdx];
    trades.push({
      strategy: rule.name, symbol: input.symbol, sector: input.sector, day: input.day, month: input.month, direction: p.dir,
      signalType: p.signal ? p.signal.type : 'random', borderline: p.signal?.borderline ?? false, signalT: p.signal?.t ?? null, signalDistancePct: p.signal?.distancePct ?? null,
      entryT: entryCandle.t, entryPrice: p.entry, exitT: candles[exitIdx].t, exitPrice: price, exitReason: reason, maePct: p.mae, mfePct: p.mfe,
      holdMinutes: Math.max(0, (candles[exitIdx].t - entryCandle.t) / 60 + (reason === 'end-of-day' ? 5 : 0)),
      dayOfMonth: Number(input.day.slice(8, 10)), sessionOfMonth: input.sessionOfMonth,
    });
    pos = null;
  };

  for (let j = 0; j < candles.length; j += 1) {
    const c = candles[j];
    const mins = candleMinutes(c.t);

    // 1. At the open: scheduled exits first, then a scheduled entry (so a reversal exits and re-enters at the same open).
    if (pos && pendingExit) close(j, c.o, 'opposite-cross');
    if (pos && squareoff !== null && mins >= squareoff) close(j, c.o, 'square-off');
    if (!pos && pendingEntry && mins >= entryFrom && mins <= entryTo && (squareoff === null || mins < squareoff)) {
      const dir = pendingEntry.direction;
      const risk = rule.stopPct !== undefined ? (c.o * rule.stopPct) / 100 : null;
      pos = {
        dir, entryIdx: j, entry: c.o, signal: pendingEntry.event, peak: c.o, mae: 0, mfe: 0,
        stop: risk !== null ? c.o - dir * risk : null,
        target: risk !== null && rule.targetR !== undefined ? c.o + dir * rule.targetR * risk : null,
        trail: rule.trailPct !== undefined ? c.o * (1 - (dir * rule.trailPct) / 100) : null,
      };
    }
    pendingEntry = null;
    pendingExit = false;

    // 2. Inside the candle: gaps through a level fill at the open, touches fill at the level, the stop wins a tie.
    if (pos) {
      const p: Pos = pos;
      const stopLevel = p.stop === null ? p.trail : p.trail === null ? p.stop : p.dir === 1 ? Math.max(p.stop, p.trail) : Math.min(p.stop, p.trail);
      const stopIsTrail = p.trail !== null && (p.stop === null || stopLevel === p.trail);
      const high = c.h, low = c.l;
      const bestOf = (hi: number, lo: number) => (p.dir === 1 ? hi : lo);
      const worstOf = (hi: number, lo: number) => (p.dir === 1 ? lo : hi);
      let exited = false;
      if (stopLevel !== null) {
        const gapped = p.dir === 1 ? c.o <= stopLevel : c.o >= stopLevel;
        const touched = p.dir === 1 ? low <= stopLevel : high >= stopLevel;
        if (gapped) { extremes(p, c.o, c.o); close(j, c.o, stopIsTrail ? 'trail-gap' : 'stop-gap'); exited = true; }
        else if (touched) { extremes(p, c.o, stopLevel); close(j, stopLevel, stopIsTrail ? 'trail' : 'stop'); exited = true; }
      }
      if (!exited && p.target !== null) {
        const gapped = p.dir === 1 ? c.o >= p.target : c.o <= p.target;
        const touched = p.dir === 1 ? high >= p.target : low <= p.target;
        if (gapped) { extremes(p, c.o, c.o); close(j, c.o, 'target-gap'); exited = true; }
        else if (touched) { extremes(p, p.target, worstOf(high, low)); close(j, p.target, 'target'); exited = true; }
      }
      if (!exited) {
        extremes(p, bestOf(high, low), worstOf(high, low));
        // A trailing stop only moves after a candle completes, so it never uses prices from inside the candle it protects.
        if (p.trail !== null && rule.trailPct !== undefined) {
          p.peak = p.dir === 1 ? Math.max(p.peak, high) : Math.min(p.peak, low);
          const next = p.peak * (1 - (p.dir * rule.trailPct) / 100);
          p.trail = p.dir === 1 ? Math.max(p.trail, next) : Math.min(p.trail, next);
        }
        if (j === candles.length - 1) close(j, c.c, 'end-of-day');
      }
    }

    // 3. After the candle closes: what did it signal? Acts at the next open.
    if (forced) {
      const f = forced.find((x) => x.index === j + 1);
      if (f && !pos) pendingEntry = { event: null, direction: f.direction };
    } else {
      const e = events[j];
      if (e) {
        eventsSeen += 1;
        const dir: 1 | -1 = e.direction === 'up' ? 1 : -1;
        if (pos && (pos as Pos).dir === -dir && rule.opposite) pendingExit = true;
        if (passes(e, filters, eventsSeen, j, candles)) pendingEntry = { event: e, direction: dir };
      }
    }
  }
  return trades;
}

// Records the best and worst price the position saw, as percent of entry in the position's favour (mfe >= 0, mae <= 0).
function extremes(p: { dir: 1 | -1; entry: number; mae: number; mfe: number }, best: number, worst: number) {
  p.mfe = Math.max(p.mfe, p.dir * ((best - p.entry) / p.entry) * 100);
  p.mae = Math.min(p.mae, p.dir * ((worst - p.entry) / p.entry) * 100);
}

export type SymbolMonthInput = { symbol: string; sector: string; month: string; days: Map<string, C5[]> };

// Simulates a whole symbol-month: day by day, carrying the month's VWAP totals forward from the first session.
export function simulateSymbolMonth(input: SymbolMonthInput, rules: ExitRule[], filters: SignalFilters = DEFAULT_FILTERS): RawTrade[] {
  const out: RawTrade[] = [];
  let prior: PriorTotals = { sumPv: 0, sumV: 0, lastClose: null, lastVwap: null };
  let session = 0;
  for (const day of [...input.days.keys()].sort()) {
    const candles = input.days.get(day)!;
    session += 1;
    const events = signalsForDay(prior, candles);
    for (const rule of rules) out.push(...simulateDay({ day, month: input.month, sessionOfMonth: session, symbol: input.symbol, sector: input.sector, candles, prior }, rule, filters, undefined, events));
    prior = foldDay(prior, candles);
  }
  return out;
}

export { istDayOf };
