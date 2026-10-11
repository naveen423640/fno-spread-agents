import { lastCompletedSession, marketSession } from '@/lib/market-session';
import { createFyersAdapter } from '@/lib/screener/broker/fyers';
import { HOLIDAYS } from '@/lib/screener/holidays';

import { atrPercent, avgVolume } from './score';
import { BOARD_CONFIG } from './config';
import { fetchFuturesOi, type OiResult } from './oi';
import { fetchQuotes, toSnapshotRow, type QuoteDeps } from './quotes';
import type { BoardStore, IntradayState } from './store';
import { floorToMinute, istDay, minutesElapsed, sessionCloseTs } from './time';
import { boardUniverse, SECTOR_INDEX_SYMBOLS } from './universe';
import type { SnapshotRow } from './types';

export type PollDeps = {
  store: BoardStore;
  credentials: { clientId: string; accessToken: string };
  now: () => Date;
  quoteDeps?: QuoteDeps;
  // Daily candles for one equity symbol; defaults to the FYERS adapter. Injected in tests.
  dailyHistory?: (symbol: string, from: string, to: string) => Promise<{ ok: true; candles: { date: string; open: number; high: number; low: number; close: number; volume: number }[] } | { ok: false; message: string }>;
  sleep?: (ms: number) => Promise<void>;
  // Futures OI for one symbol; defaults to the FYERS history call. Injected in tests.
  futuresOi?: (symbol: string, day: string) => Promise<OiResult>;
};

export type PollSummary = {
  ok: boolean;
  skipped?: string;
  ts?: number;
  day?: string;
  stocks: number;
  withOi: number;
  indices: number;
  failedBatches: number;
  loginRequired: boolean;
  errors: string[];
  baselines: { done: number; total: number };
  oi: { known: number; total: number; refreshed: number };
  // What FYERS actually returned, so field names and rejected symbols can be checked against the real feed.
  diagnostics?: { futuresReturned: number; oiFailures: string[]; oiShape: unknown; futuresRejected: { n: string; message: string }[]; equityRejected: { n: string; message: string }[]; equitySample: unknown; futuresSample: unknown; indexSample: unknown };
};

const side = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);

// Advances the cross-counters for one stock with the latest minute. A cross is a change of side against VWAP or the open.
export function advanceState(previous: IntradayState | undefined, symbol: string, day: string, row: SnapshotRow): IntradayState {
  const state: IntradayState = previous ?? { symbol, day, vwapSide: 0, openSide: 0, vwapCrossings: 0, openCrossings: 0 };
  const next = { ...state };
  if (row.vwap !== null) {
    const s = side(row.ltp - row.vwap);
    if (s !== 0) { if (state.vwapSide !== 0 && s !== state.vwapSide) next.vwapCrossings += 1; next.vwapSide = s; }
  }
  if (row.open !== null) {
    const s = side(row.ltp - row.open);
    if (s !== 0) { if (state.openSide !== 0 && s !== state.openSide) next.openCrossings += 1; next.openSide = s; }
  }
  return next;
}

async function refreshBaselines(deps: PollDeps, day: string, sessionOpen: boolean): Promise<{ done: number; total: number }> {
  const universe = boardUniverse(day);
  const existing = await deps.store.getBaselines();
  const missing = universe.filter((u) => existing.get(u.symbol)?.refreshedDay !== day);
  const history = deps.dailyHistory ?? (async (symbol, from, to) => {
    const adapter = createFyersAdapter({ credentials: deps.credentials, sleep: deps.sleep });
    const result = await adapter.history(symbol, { from, to });
    return result.ok ? { ok: true as const, candles: result.value } : { ok: false as const, message: result.message };
  });
  const to = day;
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - BOARD_CONFIG.baseline.dailyHistoryDays * 86_400_000).toISOString().slice(0, 10);
  let done = universe.length - missing.length;
  for (const u of missing.slice(0, BOARD_CONFIG.poll.baselinesPerPoll)) {
    try {
      const result = await history(u.symbol, from, to);
      if (!result.ok) continue;
      // Today's candle is still forming while the session is open, so it is left out of both baselines.
      const candles = sessionOpen ? result.candles.filter((c) => c.date < day) : result.candles;
      const atr = atrPercent(candles);
      const volume = avgVolume(candles);
      const last = candles[candles.length - 1];
      if (atr === null || volume === null || !last) continue;
      await deps.store.saveBaseline({ symbol: u.symbol, asOf: last.date, atrPct: atr, avgVolume: volume, prevClose: last.close }, day);
      done += 1;
    } catch { /* a failed symbol is retried on the next poll */ }
  }
  return { done, total: universe.length };
}

// Refreshes futures OI for the symbols whose reading is oldest (never-read first), a few per poll. One history call per future.
async function refreshOi(deps: PollDeps, universe: ReturnType<typeof boardUniverse>, today: string, ts: number): Promise<{ refreshed: number; failures: string[]; shape: unknown; loginRequired: boolean }> {
  const known = await deps.store.getOi();
  const order = [...universe].sort((a, b) => (known.get(a.futures)?.updatedTs ?? 0) - (known.get(b.futures)?.updatedTs ?? 0));
  const fetchOi = deps.futuresOi ?? ((symbol: string, day: string) => fetchFuturesOi(deps.credentials, symbol, day));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let refreshed = 0;
  const failures: string[] = [];
  let shape: unknown = null;
  for (const u of order.slice(0, BOARD_CONFIG.poll.oiPerPoll)) {
    const result = await fetchOi(u.futures, today);
    if (result.ok) { await deps.store.saveOi(u.futures, result.value, ts); refreshed += 1; }
    else {
      if (result.loginRequired) return { refreshed, failures: ['login required'], shape, loginRequired: true };
      if (failures.length < 5) failures.push(`${u.futures}: ${result.message}`);
      if (shape === null && result.shape !== undefined) shape = result.shape;
    }
    await sleep(BOARD_CONFIG.poll.historyGapMs);
  }
  return { refreshed, failures, shape, loginRequired: false };
}

// One poll: read quotes for every stock, its current-month future and the sector indices, store one snapshot per symbol for this
// minute, advance the chop counters, then refresh a few daily baselines. Never throws; failures come back in the summary.
export async function pollOnce(deps: PollDeps, options: { force?: boolean } = {}): Promise<PollSummary> {
  const now = deps.now();
  const today = istDay(now.getTime());
  const open = marketSession(now, HOLIDAYS) === 'open';
  // While the session is open a poll is stored at the current minute of today. Otherwise it stores the last session's closing
  // reading, dated to that session at 15:30, so the closing board is labelled with a real trading day.
  const day = open ? today : lastCompletedSession(now, HOLIDAYS);
  const empty: PollSummary = { ok: false, stocks: 0, withOi: 0, indices: 0, failedBatches: 0, loginRequired: false, errors: [], baselines: { done: 0, total: 0 }, oi: { known: 0, total: 0, refreshed: 0 } };
  if (!open && !options.force) return { ...empty, ok: true, skipped: 'market closed' };

  const latest = await deps.store.latestTs();
  const ts = open ? floorToMinute(now.getTime()) : sessionCloseTs(day);
  if (open && latest && latest.ts >= ts) return { ...empty, ok: true, skipped: 'already recorded this minute', ts: latest.ts, day };

  try {
    const universe = boardUniverse(today);
    const cfg = BOARD_CONFIG.poll;
    const stockQuotes = await fetchQuotes(deps.credentials, universe.map((u) => u.symbol), cfg.quoteBatchSize, cfg.quoteGapMs, deps.quoteDeps);
    if (stockQuotes.loginRequired) return { ...empty, loginRequired: true, errors: ['FYERS login required'] };
    const futQuotes = await fetchQuotes(deps.credentials, universe.map((u) => u.futures), cfg.quoteBatchSize, cfg.quoteGapMs, deps.quoteDeps);
    const idxQuotes = await fetchQuotes(deps.credentials, SECTOR_INDEX_SYMBOLS, cfg.quoteBatchSize, cfg.quoteGapMs, deps.quoteDeps);

    // OI is refreshed a few futures per poll and carried forward for the rest, so each snapshot has the latest known reading.
    const oiRun = await refreshOi(deps, universe, today, ts);
    const oiKnown = await deps.store.getOi();
    const rows: SnapshotRow[] = [];
    for (const u of universe) {
      const v = stockQuotes.quotes.get(u.symbol);
      const reading = oiKnown.get(u.futures);
      const row = v ? toSnapshotRow(u.symbol, ts, v, { oi: reading?.oi ?? null, prevOi: reading?.prevOi ?? null }) : null;
      if (row) rows.push(row);
    }
    const stocks = rows.length;
    const withOi = rows.filter((r) => r.oi !== null).length;
    for (const symbol of SECTOR_INDEX_SYMBOLS) {
      const v = idxQuotes.quotes.get(symbol);
      const row = v ? toSnapshotRow(symbol, ts, v) : null;
      if (row) rows.push(row);
    }
    const indices = rows.length - stocks;

    if (!stocks) {
      return { ...empty, errors: [...stockQuotes.errors, 'FYERS returned no stock quotes'].slice(0, 5), failedBatches: stockQuotes.failedBatches };
    }

    // Counting crosses only makes sense for live minutes; a closed-market poll just stores the last close.
    const prior = await deps.store.getStates(day);
    const states = open ? rows.filter((r) => r.symbol.endsWith('-EQ')).map((r) => advanceState(prior.get(r.symbol), r.symbol, day, r)) : [];
    await deps.store.insertSnapshots(day, rows);
    if (states.length) await deps.store.saveStates(states);

    const baselines = await refreshBaselines(deps, today, open);
    return {
      ok: true, ts, day, stocks, withOi, indices,
      failedBatches: stockQuotes.failedBatches + futQuotes.failedBatches + idxQuotes.failedBatches,
      loginRequired: false,
      errors: [...stockQuotes.errors, ...futQuotes.errors, ...idxQuotes.errors].slice(0, 5),
      baselines,
      oi: { known: withOi, total: universe.length, refreshed: oiRun.refreshed },
      diagnostics: {
        futuresReturned: futQuotes.quotes.size, oiFailures: oiRun.failures, oiShape: oiRun.shape, futuresRejected: futQuotes.rejected, equityRejected: stockQuotes.rejected,
        equitySample: stockQuotes.quotes.get('NSE:INFY-EQ') ?? null, futuresSample: futQuotes.quotes.get(universe.find((u) => u.ticker === 'INFY')?.futures ?? '') ?? null, indexSample: idxQuotes.quotes.get(SECTOR_INDEX_SYMBOLS[0]) ?? null,
      },
    };
  } catch (error) {
    console.error('board poll failed', error);
    return { ...empty, errors: ['poll failed unexpectedly'] };
  }
}

export { minutesElapsed };
