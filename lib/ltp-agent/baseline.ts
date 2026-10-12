// The random-entry baseline: what the same number of trades, at the same times of day, with the same stop and target distances, would have made if
// the entry direction and day had been picked at random. Seeded, so the same inputs always give the same numbers. Assumption: the SELL book's
// short strike is two strikes beyond the spot on the side the trade profits from (the real agent anchors it at the support or resistance strike).
import type { LtpStore } from '@/lib/ltp/store';
import { istHhmm } from '@/lib/ltp/time';
import type { Snapshot } from '@/lib/ltp/types';
import { mulberry32 } from './bootstrap';
import { closePosition, markPosition, openPosition, resolveExit, type Book, type Direction } from './books';
import type { Strategy } from './strategy';

export type TradeSpec = { underlying: string; hhmm: string; plannedRiskPts: number; rewardPts: number };
export const DEFAULT_SEEDS = 200;

function simulate(book: Book, direction: Direction, snaps: Snapshot[], at: number, spec: TradeSpec, strategy: Strategy, date: string): number | null {
  const entry = snaps[at];
  const anchor = direction === 'long' ? entry.spot - 2 * entry.step : entry.spot + 2 * entry.step;
  const opened = openPosition(book, { direction, underlying: spec.underlying, anchorStrike: anchor }, entry, strategy, date);
  if ('skipped' in opened) return null;
  const plan = { direction, stop: direction === 'long' ? entry.spot - spec.plannedRiskPts : entry.spot + spec.plannedRiskPts, target: direction === 'long' ? entry.spot + spec.rewardPts : entry.spot - spec.rewardPts };
  let position = opened;
  for (let j = at + 1; j < snaps.length; j += 1) {
    const cur = snaps[j];
    const prev = snaps[j - 1];
    position = markPosition(position, cur);
    const reason = cur.ts - prev.ts > 60 ? 'data_gap' : resolveExit(prev.spot, cur.spot, plan) ?? (istHhmm(cur.ts) >= strategy.time_exit ? 'time' : null);
    if (reason) return closePosition(position, cur, reason, strategy).netPnl;
  }
  return closePosition(position, snaps[snaps.length - 1], 'data_gap', strategy).netPnl;
}

// One mean net P&L per seed and book. A seed with no tradable random entry gives 0 for that book.
export async function randomBaseline(opts: { specs: TradeSpec[]; days: string[]; store: LtpStore; strategy: Strategy; seeds?: number }): Promise<{ buy: number[]; sell: number[] }> {
  const seeds = opts.seeds ?? DEFAULT_SEEDS;
  const data = new Map<string, Snapshot[]>();
  for (const day of opts.days) for (const u of new Set(opts.specs.map((s) => s.underlying))) data.set(`${day}|${u}`, await opts.store.snapshotsForDay(u, day));
  const out = { buy: [] as number[], sell: [] as number[] };
  for (let seed = 1; seed <= seeds; seed += 1) {
    const rand = mulberry32(seed);
    const nets: Record<Book, number[]> = { buy: [], sell: [] };
    for (const spec of opts.specs) {
      const choices = opts.days.flatMap((day) => { const snaps = data.get(`${day}|${spec.underlying}`) ?? []; const i = snaps.findIndex((s) => istHhmm(s.ts) === spec.hhmm); return i >= 0 ? [{ day, snaps, i }] : []; });
      if (!choices.length) continue;
      const pick = choices[Math.floor(rand() * choices.length)];
      const direction: Direction = rand() < 0.5 ? 'long' : 'short';
      for (const book of ['buy', 'sell'] as Book[]) { const net = simulate(book, direction, pick.snaps, pick.i, spec, opts.strategy, pick.day); if (net !== null) nets[book].push(net); }
    }
    for (const book of ['buy', 'sell'] as Book[]) out[book].push(nets[book].length ? nets[book].reduce((a, b) => a + b, 0) / nets[book].length : 0);
  }
  return out;
}
