import type { Candle } from '@/lib/screener/types';

import { buildBoard } from './board';
import { BOARD_CONFIG } from './config';
import { atrPercent, avgVolume } from './score';
import type { IntradayState, StoredSnapshot } from './store';
import type { Baseline } from './types';
import type { BoardSymbol } from './universe';
import type { C5 } from './zones';

// Replays past sessions through the same buildBoard() the live board uses, at fixed checkpoints, and measures what the top picks did
// next against a plain gainers/losers scan. Pure: all inputs are passed in.

export type StockHistory = {
  symbol: string; ticker: string; sector: string; sectorIndex: string | null;
  m5: Map<string, C5[]>; // IST date -> that session's 5-minute candles, oldest first
  daily: Candle[]; // daily candles, oldest first
  oi: Map<string, number>; // IST date -> end-of-day futures open interest
};
export type IndexHistory = Map<string, Map<string, C5[]>>; // index symbol -> IST date -> candles

export type BacktestOptions = {
  checkpoints: string[]; // 'HH:MM' IST
  horizons: number[]; // minutes ahead; the close is always added
  topNs: number[];
  roundTripCostPct: number;
  minPriorSessions: number; // sessions of daily history needed before a day can be replayed
};

export const DEFAULT_BACKTEST: BacktestOptions = { checkpoints: ['09:30', '10:00', '10:30'], horizons: [30, 60], topNs: [5, 20], roundTripCostPct: 0.1, minPriorSessions: 20 };

export type ReportRow = {
  group: string; baseline: string;
  checkpoint: string; // 'all' or 'HH:MM'
  horizon: string; // '30m', '60m' or 'close'
  sessions: number; // one observation per session
  picks: number; // individual stock picks across all observations
  avgPicksPerBoard: number;
  meanPct: number; // mean directional return per session, gross
  medianPct: number;
  hitRate: number; // share of picks that moved in the picked direction
  netMeanPct: number; // after the round-trip cost
  tStat: number | null; // mean against zero
  baselineMeanPct: number | null;
  diffPct: number | null; // group minus baseline, paired by session
  diffT: number | null;
  verdict: string;
};
export type BacktestReport = {
  firstDay: string | null; lastDay: string | null; sessions: number; checkpoints: string[]; stocks: number; replayedBoards: number;
  rows: ReportRow[]; warnings: string[];
};

const MAX_OI_DAY_CHANGE = 0.4;
const tsOf = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00+05:30`) / 1000;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function tStat(v: number[]): number | null {
  if (v.length < 3) return null;
  const m = mean(v);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  return sd === 0 ? null : m / (sd / Math.sqrt(v.length));
}

// Candles that had fully closed by `endTs` (a 5-minute candle starting at t closes at t + 300).
const closedBy = (candles: C5[], endTs: number) => candles.filter((c) => c.t + 300 <= endTs);

// Close of the last candle that ended by targetTs, if that candle ended within two candles of it (so a session that ended early gives no price).
export function exitPrice(candles: C5[], targetTs: number): number | null {
  const c = [...candles].reverse().find((x) => x.t + 300 <= targetTs);
  return c && c.t + 300 >= targetTs - 600 ? c.c : null;
}

// Daily baselines for one day from sessions strictly before it, so nothing from that day or later can leak in.
export function dailyBaselines(stocks: StockHistory[], day: string, minPriorSessions: number): Map<string, Baseline> {
  const baselines = new Map<string, Baseline>();
  for (const s of stocks) {
    const before = s.daily.filter((c) => c.date < day);
    if (before.length < minPriorSessions) continue;
    const atr = atrPercent(before);
    const vol = avgVolume(before);
    if (atr === null || vol === null) continue;
    baselines.set(s.symbol, { symbol: s.symbol, asOf: before[before.length - 1].date, atrPct: atr, avgVolume: vol, prevClose: before[before.length - 1].close });
  }
  return baselines;
}

export type Replayed = {
  board: ReturnType<typeof buildBoard>;
  everyone: { symbol: string; changePct: number }[]; // every stock on the board with its % change, for the gainers/losers baseline
  entry: Map<string, { price: number; session: C5[] }>;
  endTs: number;
};

// The board as it would have looked at one checkpoint, built only from candles that had closed by then.
export function replayBoard(stocks: StockHistory[], indices: IndexHistory, day: string, checkpoint: string, baselines: Map<string, Baseline>): Replayed | null {
  const cfg = BOARD_CONFIG;
  const endTs = tsOf(day, checkpoint);
  const minutes = (endTs - tsOf(day, '09:15')) / 60;
  const rows: StoredSnapshot[] = [];
  const states = new Map<string, IntradayState>();
  const sameTime = new Map<string, number[]>();
  const universe: BoardSymbol[] = [];
  const entry = new Map<string, { price: number; session: C5[] }>();
  const everyone: { symbol: string; changePct: number }[] = [];

  for (const s of stocks) {
    const base = baselines.get(s.symbol);
    const session = s.m5.get(day);
    if (!base || !session) continue;
    const seen = closedBy(session, endTs);
    if (seen.length < 2) continue;
    let cumVol = 0, pv = 0, vwapSide = 0, openSide = 0, vwapCrossings = 0, openCrossings = 0, high = -Infinity, low = Infinity;
    const open = seen[0].o;
    for (const c of seen) {
      cumVol += c.v; pv += ((c.h + c.l + c.c) / 3) * c.v; high = Math.max(high, c.h); low = Math.min(low, c.l);
      if (cumVol > 0) { const side = Math.sign(c.c - pv / cumVol); if (side !== 0) { if (vwapSide !== 0 && side !== vwapSide) vwapCrossings += 1; vwapSide = side; } }
      const oside = Math.sign(c.c - open);
      if (oside !== 0) { if (openSide !== 0 && oside !== openSide) openCrossings += 1; openSide = oside; }
    }
    const last = seen[seen.length - 1];
    const known = [...s.oi.keys()].filter((d) => d < day).sort(); // OI up to the previous close only
    let oi = known.length >= 2 ? s.oi.get(known[known.length - 1]) ?? null : null;
    let prevOi = known.length >= 2 ? s.oi.get(known[known.length - 2]) ?? null : null;
    // A jump of more than 40% in a day is a contract roll in the stitched futures series, not real positioning, so it is ignored.
    if (oi !== null && prevOi !== null && prevOi > 0 && Math.abs(oi / prevOi - 1) > MAX_OI_DAY_CHANGE) { oi = null; prevOi = null; }
    rows.push({ symbol: s.symbol, ts: endTs, day, ltp: last.c, volume: cumVol, oi, prevOi, open, high, low, prevClose: base.prevClose, vwap: cumVol > 0 ? pv / cumVol : null });
    states.set(s.symbol, { symbol: s.symbol, day, vwapSide, openSide, vwapCrossings, openCrossings });
    // The true same-time volume of earlier sessions replaces the pro-rated estimate the live board uses early on.
    const history: number[] = [];
    for (const d of [...s.m5.keys()].filter((x) => x < day).sort().slice(-cfg.sameTimeHistory.maxSessions)) {
      const past = closedBy(s.m5.get(d) ?? [], tsOf(d, checkpoint));
      if (past.length) history.push(past.reduce((a, c) => a + c.v, 0));
    }
    sameTime.set(s.symbol, history);
    universe.push({ ticker: s.ticker, name: s.ticker, symbol: s.symbol, futures: '', sector: s.sector, sectorIndex: s.sectorIndex });
    entry.set(s.symbol, { price: last.c, session });
    everyone.push({ symbol: s.symbol, changePct: ((last.c - base.prevClose) / base.prevClose) * 100 });
  }
  for (const [index, sessions] of indices) {
    const session = sessions.get(day);
    const previousDay = [...sessions.keys()].filter((d) => d < day).sort().pop();
    const previousClose = previousDay ? sessions.get(previousDay)?.slice(-1)[0]?.c : undefined;
    const seen = session ? closedBy(session, endTs) : [];
    if (!seen.length || !previousClose) continue;
    rows.push({ symbol: index, ts: endTs, day, ltp: seen[seen.length - 1].c, volume: null, oi: null, prevOi: null, open: seen[0].o, high: null, low: null, prevClose: previousClose, vwap: null });
  }
  if (universe.length < 20) return null;
  return { board: buildBoard({ universe, rows, baselines, states, sameTimeVolumes: sameTime, minutes }), everyone, entry, endTs };
}

type Observation = { day: string; checkpoint: string; horizon: string; group: string; mean: number; picks: number; hits: number };

export function runBacktest(stocks: StockHistory[], indices: IndexHistory, options: BacktestOptions = DEFAULT_BACKTEST): BacktestReport {
  const allDays = new Set<string>();
  for (const s of stocks) for (const d of s.m5.keys()) allDays.add(d);
  const days = [...allDays].sort();
  const observations: Observation[] = [];
  let replayed = 0;

  for (const day of days) {
    const baselines = dailyBaselines(stocks, day, options.minPriorSessions);
    if (baselines.size < 20) continue;
    for (const checkpoint of options.checkpoints) {
      const r = replayBoard(stocks, indices, day, checkpoint, baselines);
      if (!r) continue;
      replayed += 1;
      const gainers = [...r.everyone].sort((a, b) => b.changePct - a.changePct);
      const losers = [...r.everyone].sort((a, b) => a.changePct - b.changePct);
      const groups: { name: string; side: 1 | -1; symbols: string[] }[] = [];
      for (const n of options.topNs) {
        groups.push({ name: `Score top ${n} bullish`, side: 1, symbols: r.board.bullish.slice(0, n).map((e) => e.symbol) });
        groups.push({ name: `Score top ${n} bearish`, side: -1, symbols: r.board.bearish.slice(0, n).map((e) => e.symbol) });
        groups.push({ name: `Top ${n} gainers`, side: 1, symbols: gainers.slice(0, n).map((e) => e.symbol) });
        groups.push({ name: `Top ${n} losers`, side: -1, symbols: losers.slice(0, n).map((e) => e.symbol) });
      }
      const horizons: { label: string; price: (session: C5[]) => number | null }[] = [
        ...options.horizons.map((m) => ({ label: `${m}m`, price: (session: C5[]) => exitPrice(session, r.endTs + m * 60) })),
        { label: 'close', price: (session: C5[]) => (session.length ? session[session.length - 1].c : null) },
      ];
      for (const g of groups) {
        for (const h of horizons) {
          const returns: number[] = [];
          for (const symbol of g.symbols) {
            const e = r.entry.get(symbol);
            const out = e ? h.price(e.session) : null;
            if (!e || out === null || e.price <= 0) continue;
            returns.push(g.side * ((out - e.price) / e.price) * 100);
          }
          if (returns.length) observations.push({ day, checkpoint, horizon: h.label, group: g.name, mean: mean(returns), picks: returns.length, hits: returns.filter((x) => x > 0).length });
        }
      }
    }
  }

  // One observation per session (averaged over the chosen checkpoints), so the three checkpoints of a day are not counted as three
  // independent samples.
  const horizonLabels = [...options.horizons.map((m) => `${m}m`), 'close'];
  const pairs: [string, string][] = [];
  for (const n of options.topNs) pairs.push([`Score top ${n} bullish`, `Top ${n} gainers`], [`Score top ${n} bearish`, `Top ${n} losers`]);
  const bySession = (group: string, horizon: string, checkpoint: string) => {
    const out = new Map<string, { means: number[]; picks: number; hits: number; boards: number }>();
    for (const o of observations) {
      if (o.group !== group || o.horizon !== horizon || (checkpoint !== 'all' && o.checkpoint !== checkpoint)) continue;
      const b = out.get(o.day) ?? { means: [], picks: 0, hits: 0, boards: 0 };
      b.means.push(o.mean); b.picks += o.picks; b.hits += o.hits; b.boards += 1; out.set(o.day, b);
    }
    return out;
  };
  const rows: ReportRow[] = [];
  for (const checkpoint of ['all', ...options.checkpoints]) {
    for (const horizon of horizonLabels) {
      for (const [group, baseline] of pairs) {
        const a = bySession(group, horizon, checkpoint);
        const b = bySession(baseline, horizon, checkpoint);
        const sessionMeans = [...a.values()].map((v) => mean(v.means));
        if (!sessionMeans.length) continue;
        const picks = [...a.values()].reduce((x, v) => x + v.picks, 0);
        const hits = [...a.values()].reduce((x, v) => x + v.hits, 0);
        const boards = [...a.values()].reduce((x, v) => x + v.boards, 0);
        const diffs = [...a.keys()].filter((d) => b.has(d)).map((d) => mean(a.get(d)!.means) - mean(b.get(d)!.means));
        const t = tStat(diffs);
        const m = mean(sessionMeans);
        const verdict = diffs.length < 30 ? 'not enough sessions to conclude' : t === null || Math.abs(t) < 2 ? 'no clear difference (within noise)' : t > 0 ? 'score beats the baseline' : 'baseline beats the score';
        rows.push({
          group, baseline, checkpoint, horizon, sessions: sessionMeans.length, picks, avgPicksPerBoard: picks / boards,
          meanPct: m, medianPct: median(sessionMeans), hitRate: picks ? hits / picks : 0, netMeanPct: m - options.roundTripCostPct, tStat: tStat(sessionMeans),
          baselineMeanPct: b.size ? mean([...b.values()].map((v) => mean(v.means))) : null, diffPct: diffs.length ? mean(diffs) : null, diffT: t, verdict,
        });
      }
    }
  }

  const sessionsReplayed = new Set(observations.map((o) => o.day)).size;
  const warnings: string[] = [];
  if (sessionsReplayed < 30) warnings.push(`Only ${sessionsReplayed} sessions could be replayed. That is too few to say whether the score adds an edge; treat every difference as noise.`);
  warnings.push("Open interest in this replay is the previous day's change (intraday OI history does not exist), so the OI component is weaker than on the live board.");
  warnings.push('The choppy filter counts crossings on 5-minute closes here, not per-minute snapshots, so it behaves slightly differently from live.');
  warnings.push("The stock list is today's F&O universe, so stocks that left the list in this period are missing (survivorship bias). Returns are gross of slippage; the net column subtracts a flat round-trip cost.");
  warnings.push('Sessions, stocks and checkpoints are correlated, and many rows are tested at once, so a single "significant" row can still be luck.');
  return { firstDay: days[0] ?? null, lastDay: days[days.length - 1] ?? null, sessions: sessionsReplayed, checkpoints: options.checkpoints, stocks: stocks.length, replayedBoards: replayed, rows, warnings };
}
