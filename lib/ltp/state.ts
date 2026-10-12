// Everything the LTP Levels tab shows for one underlying, built from the store only (never from FYERS). The route is a thin wrapper so this
// can be tested against an in-memory database.
import { analyzeSession, type SessionAnalysis } from './analyze';
import { EXTENSION_METHODS, writerBreakeven } from './extensions';
import { freezeLines0920, type Lines0920 } from './lines0920';
import { health, UNDERLYINGS, type Health } from './recorder';
import type { LtpStore } from './store';
import { istDate } from './time';
import { weeklyRangeFromSnapshots, type WeeklyFromSnapshots } from './weekly';
import { strikesOf, type Snapshot } from './types';

const CHAIN_STRIKES_EACH_SIDE = 8;

export type Cell = { ltp: number | null; oi: number | null; oiChange: number | null; volume: number | null };
export type ChainView = {
  strike: number;
  ce: Cell | null; pe: Cell | null;
  mark: 'line_low' | 'line_high' | 'line' | null; // the two strikes around the imaginary line (one strike when the spot is exactly on it)
  role: 'support' | 'resistance' | null;
  callReversal: number | null; putReversal: number | null; // proxies, under the selected method
};
export type LtpState =
  | { empty: true; reason: 'no_data_yet' | 'no_data_for_date'; underlying: string; date: string | null; health: Health }
  | {
    empty: false; underlying: string; date: string; viewingStoredDay: boolean; snapshotTs: number; snapshotCount: number;
    health: Health; analysis: SessionAnalysis; chain: ChainView[];
    methods: { id: string; label: string }[]; selectedMethod: string;
    lines0920: Lines0920 | null; weekly: WeeklyFromSnapshots | null; weeklyWeekStart: string | null;
  };

export type StateOptions = { underlying: string; date?: string; nowTs: number; method?: string; holidays: ReadonlySet<string> };

const cell = (s: Snapshot, strike: number, side: 'CE' | 'PE'): Cell | null => {
  const r = s.rows.find((x) => x.strike === strike && x.side === side);
  return r ? { ltp: r.ltp, oi: r.oi, oiChange: r.oiChange, volume: r.volume } : null;
};

export async function buildState(store: LtpStore, opts: StateOptions): Promise<LtpState> {
  const { underlying, nowTs } = opts;
  const h = await health(store, nowTs, UNDERLYINGS, opts.holidays);
  const today = istDate(nowTs);
  const date = opts.date ?? ((await store.countForDay(underlying, today)) > 0 ? today : await store.latestDate(underlying));
  if (!date) return { empty: true, reason: 'no_data_yet', underlying, date: null, health: h };
  const snaps = await store.snapshotsForDay(underlying, date);
  if (!snaps.length) return { empty: true, reason: 'no_data_for_date', underlying, date, health: h };

  const last = snaps[snaps.length - 1];
  const method = EXTENSION_METHODS.find((m) => m.id === opts.method) ?? writerBreakeven;
  const analysis = analyzeSession(snaps, { now: last.ts, method });

  // The 9:20 lines are frozen: the first time they can be computed they are saved, and from then on the saved copy is shown.
  let lines0920 = (await store.getLines0920(date, underlying)) as Lines0920 | null;
  if (!lines0920) {
    lines0920 = freezeLines0920(snaps, writerBreakeven);
    if (lines0920) await store.saveLines0920(date, underlying, lines0920);
  }

  // The weekly range comes from the first stored day of the current expiry (the first day of the expiry week we have data for), saved once.
  const weeklyWeekStart = await store.firstDateForExpiry(underlying, last.expiry);
  let weekly: WeeklyFromSnapshots | null = null;
  if (weeklyWeekStart) {
    weekly = (await store.getWeekly(weeklyWeekStart, underlying)) as WeeklyFromSnapshots | null;
    if (!weekly) {
      weekly = weeklyRangeFromSnapshots(await store.snapshotsForDay(underlying, weeklyWeekStart));
      if (weekly) await store.saveWeekly(weeklyWeekStart, underlying, weekly);
    }
  }

  let chain: ChainView[] = [];
  if (analysis.empty === false && analysis.usable) {
    const { line, support, resistance } = analysis.levels;
    const strikes = strikesOf(last);
    const anchor = strikes.findIndex((k) => k >= line.low);
    const from = Math.max(0, anchor - CHAIN_STRIKES_EACH_SIDE);
    const to = Math.min(strikes.length, anchor + CHAIN_STRIKES_EACH_SIDE + 2);
    chain = strikes.slice(from, to).map((strike) => ({
      strike, ce: cell(last, strike, 'CE'), pe: cell(last, strike, 'PE'),
      mark: line.exact && strike === line.low ? 'line' : strike === line.low ? 'line_low' : strike === line.high ? 'line_high' : null,
      role: strike === support.strike ? 'support' : strike === resistance.strike ? 'resistance' : null,
      callReversal: method.reversal(last, strike, 'CE'), putReversal: method.reversal(last, strike, 'PE'),
    }));
  }

  return {
    empty: false, underlying, date, viewingStoredDay: date !== today, snapshotTs: last.ts, snapshotCount: snaps.length, health: h, analysis, chain,
    methods: EXTENSION_METHODS.map((m) => ({ id: m.id, label: m.label })), selectedMethod: method.id, lines0920, weekly, weeklyWeekStart,
  };
}
