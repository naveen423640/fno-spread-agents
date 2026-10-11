import { marketSession } from '@/lib/market-session';
import { HOLIDAYS } from '@/lib/screener/holidays';

import { BOARD_CONFIG, type BoardConfig } from './config';
import { expectedVolume, scoreStock } from './score';
import type { BoardStore, IntradayState, StoredSnapshot } from './store';
import { isoFromTs, minutesElapsed, sessionOpenTs } from './time';
import { boardUniverse, type BoardSymbol } from './universe';
import type { Baseline, BoardEntry, BoardPayload } from './types';

export type BuildInput = {
  universe: BoardSymbol[];
  rows: StoredSnapshot[]; // stock and sector-index rows for one minute
  baselines: Map<string, Baseline>;
  states: Map<string, IntradayState>;
  sameTimeVolumes: Map<string, number[]>; // past sessions' cumulative volume at this time of day, per symbol
  minutes: number;
  config?: BoardConfig;
};

const pct = (value: number, base: number) => ((value - base) / base) * 100;

// Pure: ranks the universe from one minute of snapshots. A stock with no price, no daily baseline or a failed filter is left out.
export function buildBoard(input: BuildInput): Pick<BoardPayload, 'bullish' | 'bearish' | 'coverage'> {
  const config = input.config ?? BOARD_CONFIG;
  const byRow = new Map(input.rows.map((r) => [r.symbol, r]));
  const bullish: BoardEntry[] = [];
  const bearish: BoardEntry[] = [];
  let scored = 0, withBaseline = 0, withOi = 0, skipped = 0;

  for (const u of input.universe) {
    const row = byRow.get(u.symbol);
    const baseline = input.baselines.get(u.symbol);
    if (!row || !baseline) { skipped += 1; continue; }
    withBaseline += 1;
    const prevClose = row.prevClose ?? baseline.prevClose;
    const index = u.sectorIndex ? byRow.get(u.sectorIndex) : undefined;
    const sectorChangePct = index && index.prevClose ? pct(index.ltp, index.prevClose) : null;
    const oiChangePct = row.oi !== null && row.prevOi ? pct(row.oi, row.prevOi) : null;
    if (oiChangePct !== null) withOi += 1;
    const state = input.states.get(u.symbol);
    const result = scoreStock({
      price: row.ltp, prevClose, atrPct: baseline.atrPct, volume: row.volume,
      expectedVolume: expectedVolume({ avgDailyVolume: baseline.avgVolume, minutesElapsed: input.minutes, profile: config.volumeProfile, history: input.sameTimeVolumes.get(u.symbol) ?? [], minSessions: config.sameTimeHistory.minSessions }),
      oiChangePct, sectorChangePct, minutesElapsed: input.minutes, dayHigh: row.high, dayLow: row.low,
      vwapCrossings: state?.vwapCrossings ?? 0, openCrossings: state?.openCrossings ?? 0,
    }, config);
    scored += 1;
    if (!result.direction || Math.abs(result.score) < config.board.minAbsScore) continue;
    const entry: BoardEntry = {
      symbol: u.symbol, ticker: u.ticker, sector: u.sector, price: row.ltp, changePct: result.changePct, score: result.score,
      direction: result.direction, components: result.components, oi: result.oi, oiChangePct, volumeRatio: result.volumeRatio, moveAtr: result.moveAtr,
    };
    (result.direction === 'bull' ? bullish : bearish).push(entry);
  }
  bullish.sort((a, b) => b.score - a.score);
  bearish.sort((a, b) => a.score - b.score);
  return { bullish: bullish.slice(0, config.board.topN), bearish: bearish.slice(0, config.board.topN), coverage: { symbols: input.universe.length, scored, withBaseline, withOi, skipped } };
}

const emptyPayload = (notes: string[]): BoardPayload => ({ asOf: null, sessionDate: null, live: false, bullish: [], bearish: [], coverage: { symbols: 0, scored: 0, withBaseline: 0, withOi: 0, skipped: 0 }, notes });

export async function loadBoard(store: BoardStore, now: Date): Promise<BoardPayload> {
  const latest = await store.latestTs();
  if (!latest) return emptyPayload(['No snapshots recorded yet. Press Refresh while FYERS is connected to record the first one.']);
  const universe = boardUniverse(latest.day);
  const rows = await store.snapshotsAt(latest.ts);
  const baselines = await store.getBaselines();
  const states = await store.getStates(latest.day);
  const minutes = minutesElapsed(latest.ts, latest.day);

  // Same-time volume from recorded past sessions, only once enough of them exist.
  const sameTimeVolumes = new Map<string, number[]>();
  const { minSessions, maxSessions } = BOARD_CONFIG.sameTimeHistory;
  const pastDays = await store.recentDays(maxSessions, latest.day);
  if (pastDays.length >= minSessions) {
    for (const day of pastDays) {
      const volumes = await store.volumesNear(day, sessionOpenTs(day) + minutes * 60, 180);
      for (const [symbol, volume] of volumes) sameTimeVolumes.set(symbol, [...(sameTimeVolumes.get(symbol) ?? []), volume]);
    }
  }

  const built = buildBoard({ universe, rows, baselines, states, sameTimeVolumes, minutes });
  const live = marketSession(now, HOLIDAYS) === 'open' && now.getTime() / 1000 - latest.ts < 5 * 60;
  const notes: string[] = [];
  if (built.coverage.withBaseline < built.coverage.symbols) notes.push(`Daily baselines ready for ${built.coverage.withBaseline} of ${built.coverage.symbols} stocks; the rest join the board as they load.`);
  if (built.coverage.withOi === 0 && built.coverage.withBaseline > 0) notes.push('No futures OI came back, so the OI component is zero for every stock.');
  notes.push(pastDays.length >= minSessions ? `Volume compares with the recorded same-time average of ${Math.min(pastDays.length, maxSessions)} sessions.` : `Volume compares with the 20-day daily average spread over the session (${pastDays.length} of ${minSessions} recorded sessions needed for same-time averages).`);
  return { asOf: isoFromTs(latest.ts), sessionDate: latest.day, live, ...built, notes };
}
