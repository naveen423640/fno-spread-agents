import { istDate, lastCompletedSession } from '../market-session';
import { bs, runBacktest } from './backtest';
import { createMockAdapter } from './broker/mock';
import { addDays, type BrokerAdapter } from './broker/types';
import { DEFAULT_PARAMS, UNIVERSE, validateParams, type ScreenerParams } from './config';
import { addIndicators } from './indicators';
import { runScan } from './scan';
import { buildActionPlan, spreadCheck, supportResistance, type ActionPlan, type SpreadCheck } from './spread';
import type { JobKind, ScreenerStore } from './store';
import { monthlyExpiry } from './symbols';
import { makeSynthetic } from './synthetic';
import type { BrokerErrorCode, Candle, ScanRow, Side, TradeStats } from './types';

// Orchestration for the Screener: candle refresh (once per trading day), background scan and backtest jobs, the live option
// check and the candidate drawer data. Everything here is read-only: the broker adapter has no way to place or change an order.

export const SOURCES = ['fyers', 'kite', 'synthetic'] as const;
export type Source = (typeof SOURCES)[number];
export const BENCH = '^NSEI';
export const MIN_TRADES = 100;
export const BACKTEST_BANNER = 'Options modelled with Black-Scholes and an IV proxy (1.1 x 20-day realised volatility, no skew, no real option prices), indicative only.';
const SCAN_YEARS = 2;
const BACKTEST_YEARS = 5;

export type ScreenerDeps = {
  store: ScreenerStore;
  brokerFor: (source: Exclude<Source, 'synthetic'>) => BrokerAdapter | null; // null when not signed in or not configured
  now: () => Date;
  schedule: (work: Promise<unknown>) => void;
  newId: () => string;
  holidays: ReadonlySet<string>;
  universe: Record<string, string>;
  maxJobsPerDay: number;
  synthetic: { stocks: number; days: number; seed: number };
};

const isSource = (value: unknown): value is Source => (SOURCES as readonly unknown[]).includes(value);

// ---------------------------------------------------------------- candle refresh

export type RefreshResult = {
  data: Record<string, Candle[]>;
  bench: Candle[] | null;
  skipped: { symbol: string; reason: string }[];
  loginRequired: boolean;
  asOf: string | null;
};

// Loads daily candles for the tickers and the benchmark index. A symbol is fetched at most once per trading day: a cache that
// already reaches the last completed session (and far enough back) makes no broker call. Otherwise only a short overlapping range
// is fetched. Candles for a session that has not finished are never kept. A login failure stops everything immediately.
export async function refreshCandles(deps: ScreenerDeps, broker: BrokerAdapter, source: Source, tickers: string[], years: number, onProgress?: (done: number, total: number) => void): Promise<RefreshResult> {
  const now = deps.now();
  const today = istDate(now);
  const completed = lastCompletedSession(now, deps.holidays);
  const needFrom = addDays(today, -years * 365);
  const useCache = source !== 'synthetic';
  const items = [...tickers.map((key) => ({ key, symbol: broker.equitySymbol(key) })), { key: BENCH, symbol: broker.indexSymbol() }];
  const result: RefreshResult = { data: {}, bench: null, skipped: [], loginRequired: false, asOf: null };

  let done = 0;
  for (const item of items) {
    const cached = useCache ? await deps.store.getCandles(source, item.key) : null;
    const reaches = cached !== null && cached.coversFrom <= addDays(needFrom, 30);
    let candles: Candle[] | null = null;
    if (cached && reaches && cached.lastDate >= completed) {
      candles = cached.candles;
    } else {
      const incremental = cached !== null && reaches;
      const range = incremental ? { from: addDays(cached.lastDate, -7), to: today } : { from: needFrom, to: today };
      const fetched = await broker.history(item.symbol, range);
      if (fetched.ok) {
        const merged = new Map((incremental ? cached.candles : []).map((c) => [c.date, c]));
        for (const c of fetched.value) merged.set(c.date, c);
        candles = [...merged.values()].filter((c) => c.date <= completed).sort((a, b) => a.date.localeCompare(b.date));
        if (useCache && candles.length) await deps.store.saveCandles(source, item.key, candles, incremental ? cached.coversFrom : needFrom);
      } else if (fetched.code === 'LOGIN_REQUIRED') {
        result.loginRequired = true;
        return result;
      } else if (cached) {
        candles = cached.candles;
        result.skipped.push({ symbol: item.key, reason: `${fetched.message} (using cached data from ${cached.lastDate})` });
      } else {
        result.skipped.push({ symbol: item.key, reason: fetched.message });
      }
    }
    if (candles?.length) {
      if (item.key === BENCH) result.bench = candles;
      else result.data[item.key] = candles;
      const last = candles[candles.length - 1].date;
      if (!result.asOf || last > result.asOf) result.asOf = last;
    }
    done += 1;
    onProgress?.(done, items.length);
  }
  return result;
}

// ---------------------------------------------------------------- brokers and tickers

function syntheticSetup(deps: ScreenerDeps) {
  const { data, bench } = makeSynthetic({ ...deps.synthetic, endDate: lastCompletedSession(deps.now(), deps.holidays) });
  return { data, bench, adapter: createMockAdapter({ data, bench, defaultLot: 100 }) };
}

function brokerAndTickers(deps: ScreenerDeps, source: Source): { broker: BrokerAdapter; tickers: string[] } | null {
  if (source === 'synthetic') {
    const { data, adapter } = syntheticSetup(deps);
    return { broker: adapter, tickers: Object.keys(deps.universe).filter((t) => t in data) };
  }
  const broker = deps.brokerFor(source);
  return broker ? { broker, tickers: Object.keys(deps.universe) } : null;
}

// ---------------------------------------------------------------- jobs

export type ScanResult = { kind: 'scan'; asOf: string; generatedAt: string; source: Source; expiry: string; params: ScreenerParams; rows: ScanRow[]; skipped: RefreshResult['skipped']; counts: { symbols: number; signal: number; watch: number } };
export type VariantView = { name: string; side: Side; stats: TradeStats; firstHalf?: TradeStats; secondHalf?: TradeStats; tradeCount: number; lowSample: boolean };
export type BacktestResult = { kind: 'backtest'; asOf: string; generatedAt: string; source: Source; params: ScreenerParams; variants: VariantView[]; skipped: RefreshResult['skipped']; minTrades: number; banner: string };

export type StartResult = { jobId: string } | { error: string; status: 400 | 401 | 429 };

export async function startScreenerJob(deps: ScreenerDeps, request: { kind?: unknown; source?: unknown; params?: unknown }): Promise<StartResult> {
  const { kind, source } = request;
  if (kind !== 'scan' && kind !== 'backtest') return { error: 'kind must be "scan" or "backtest".', status: 400 };
  if (!isSource(source)) return { error: 'source must be "fyers", "kite" or "synthetic".', status: 400 };
  const params = validateParams(request.params ?? {});
  if (!params.ok) return { error: params.error, status: 400 };
  const setup = brokerAndTickers(deps, source);
  if (!setup) return { error: `Sign in to ${source === 'kite' ? 'Kite' : 'FYERS'} first (the broker connection is missing or has expired).`, status: 401 };
  const since = new Date(deps.now().getTime() - 86_400_000).toISOString();
  if ((await deps.store.countJobsSince(since)) >= deps.maxJobsPerDay) return { error: 'The daily screener job limit has been reached. Try again tomorrow.', status: 429 };

  const id = deps.newId();
  await deps.store.createJob({ id, kind, source, params: params.value });
  deps.schedule(runJob(deps, id, kind, source, params.value, setup.broker, setup.tickers));
  return { jobId: id };
}

async function runJob(deps: ScreenerDeps, id: string, kind: JobKind, source: Source, params: ScreenerParams, broker: BrokerAdapter, tickers: string[]) {
  let lastPercent = -1;
  const progress = (percent: number, message: string) => {
    const rounded = Math.round(percent);
    if (rounded === lastPercent) return Promise.resolve();
    lastPercent = rounded;
    return deps.store.updateJob(id, { progress: rounded, message });
  };
  const loginRequired = () => deps.store.updateJob(id, { status: 'login_required', message: 'The broker login has expired. Sign in again, then run it again.' });
  try {
    const years = kind === 'scan' ? SCAN_YEARS : BACKTEST_YEARS;
    const pending: Promise<unknown>[] = [];
    const refreshed = await refreshCandles(deps, broker, source, tickers, years, (done, total) => { pending.push(progress((done / total) * (kind === 'scan' ? 70 : 50), `Loading candles ${done}/${total}`)); });
    await Promise.all(pending);
    if (refreshed.loginRequired) return await loginRequired();
    if (!refreshed.bench) return await deps.store.updateJob(id, { status: 'failed', message: 'The benchmark index candles could not be loaded, so relative strength cannot be computed.' });
    if (!refreshed.asOf) return await deps.store.updateJob(id, { status: 'failed', message: 'No candles could be loaded for any symbol.' });
    const generatedAt = deps.now().toISOString();

    if (kind === 'scan') {
      const expiry = monthlyExpiry(istDate(deps.now()));
      const rows = runScan(refreshed.data, refreshed.bench, params, { expiry, universe: deps.universe });
      const lots = new Map<string, number | null>();
      let index = 0;
      for (const row of rows) {
        if (!lots.has(row.symbol)) {
          const lot = await broker.lotSize(row.symbol, expiry);
          if (!lot.ok && lot.code === 'LOGIN_REQUIRED') return await loginRequired();
          lots.set(row.symbol, lot.ok ? lot.value : null);
        }
        index += 1;
        await progress(70 + (index / rows.length) * 28, `Looking up lot sizes ${index}/${rows.length}`);
      }
      const finalRows = rows.map((row) => ({ ...row, lotSize: lots.get(row.symbol) ?? null }));
      const result: ScanResult = {
        kind: 'scan', asOf: refreshed.asOf, generatedAt, source, expiry, params, rows: finalRows, skipped: refreshed.skipped,
        counts: { symbols: Object.keys(refreshed.data).length, signal: finalRows.filter((r) => r.status === 'SIGNAL').length, watch: finalRows.filter((r) => r.status === 'WATCH').length },
      };
      await deps.store.updateJob(id, { status: 'done', progress: 100, message: `Scan complete: ${result.counts.signal} signal, ${result.counts.watch} watch`, result });
      return;
    }

    const variants = runBacktest(refreshed.data, refreshed.bench, params, (done, total) => { pending.push(progress(50 + (done / total) * 49, `Backtesting variant ${done}/${total}`)); });
    await Promise.all(pending);
    const result: BacktestResult = {
      kind: 'backtest', asOf: refreshed.asOf, generatedAt, source, params, skipped: refreshed.skipped, minTrades: MIN_TRADES, banner: BACKTEST_BANNER,
      variants: variants.map((v) => ({ name: v.name, side: v.side, stats: v.stats, firstHalf: v.firstHalf, secondHalf: v.secondHalf, tradeCount: v.trades.length, lowSample: v.trades.length < MIN_TRADES })),
    };
    await deps.store.updateJob(id, { status: 'done', progress: 100, message: 'Backtest complete', result });
  } catch (error) {
    await deps.store.updateJob(id, { status: 'failed', message: `The job failed: ${error instanceof Error ? error.message : String(error)}` });
  }
}

// ---------------------------------------------------------------- live option check

export type CheckFailure = { ok: false; code: BrokerErrorCode | 'BAD_REQUEST' | 'BAD_QUOTES'; message: string };
export type CheckSuccess = { ok: true; asOf: string; longSymbol: string; shortSymbol: string; lot: number; check: Extract<SpreadCheck, { ok: true }> };

const validIso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

type SpreadRequest = { source?: unknown; symbol?: unknown; side?: unknown; kLong?: unknown; kShort?: unknown; expiry?: unknown };

function parseSpreadRequest(deps: ScreenerDeps, input: SpreadRequest): { ok: true; source: Source; symbol: string; side: Side; kLong: number; kShort: number; expiry: string } | CheckFailure {
  const bad = (message: string): CheckFailure => ({ ok: false, code: 'BAD_REQUEST', message });
  if (!isSource(input.source)) return bad('source must be "fyers", "kite" or "synthetic".');
  if (typeof input.symbol !== 'string' || !(input.symbol in deps.universe)) return bad('Choose a stock from the screener universe.');
  if (input.side !== 'bull' && input.side !== 'bear') return bad('side must be "bull" or "bear".');
  if (!positive(input.kLong) || !positive(input.kShort)) return bad('Both strikes must be positive numbers.');
  if (!validIso(input.expiry)) return bad('expiry must be a valid YYYY-MM-DD date.');
  const side: Side = input.side === 'bull' ? 1 : -1;
  if (side > 0 ? input.kShort <= input.kLong : input.kShort >= input.kLong) return bad(side > 0 ? 'A bull call spread sells a higher strike than it buys.' : 'A bear put spread sells a lower strike than it buys.');
  return { ok: true, source: input.source, symbol: input.symbol, side, kLong: input.kLong, kShort: input.kShort, expiry: input.expiry };
}

export async function runScreenerCheck(deps: ScreenerDeps, input: SpreadRequest): Promise<CheckSuccess | CheckFailure> {
  const request = parseSpreadRequest(deps, input);
  if (!request.ok) return request;
  const setup = brokerAndTickers(deps, request.source);
  if (!setup) return { ok: false, code: 'LOGIN_REQUIRED', message: 'Sign in to the broker first (the connection is missing or has expired).' };
  const { broker } = setup;
  const kind = request.side > 0 ? 'CE' : 'PE';
  const longSymbol = broker.optionSymbol(request.symbol, request.expiry, request.kLong, kind);
  const shortSymbol = broker.optionSymbol(request.symbol, request.expiry, request.kShort, kind);

  const legs = [];
  for (const [symbol, strike] of [[longSymbol, request.kLong], [shortSymbol, request.kShort]] as const) {
    const quote = await broker.quote(symbol);
    if (!quote.ok) return { ok: false, code: quote.code, message: quote.message };
    let { oi } = quote.value;
    if (oi === null) {
      const lookup = await broker.optionOi(request.symbol, request.expiry, strike, kind);
      oi = lookup.ok ? lookup.value : null;
    }
    legs.push({ ...quote.value, oi });
  }
  const lot = await broker.lotSize(request.symbol, request.expiry);
  if (!lot.ok) return { ok: false, code: lot.code, message: lot.message };
  const check = spreadCheck({ side: request.side, kLong: request.kLong, kShort: request.kShort, long: legs[0], short: legs[1], lot: lot.value });
  if (!check.ok) return { ok: false, code: 'BAD_QUOTES', message: check.reason };
  return { ok: true, asOf: deps.now().toISOString(), longSymbol, shortSymbol, lot: lot.value, check };
}

// ---------------------------------------------------------------- candidate drawer

export type DetailPoint = { date: string; close: number; high: number; low: number; sma20: number | null; sma50: number | null; sma200: number | null; rsi: number | null };
export type DetailSuccess = {
  ok: true; symbol: string; sector: string; asOf: string; lastClose: number; series: DetailPoint[];
  levels: { support: number[]; resistance: number[] }; plan: ActionPlan | null; planBasis: 'live quote' | 'modelled'; planNote: string | null;
};
export type DetailFailure = { ok: false; code: 'BAD_REQUEST' | 'NO_DATA'; message: string };

const finite = (value: number) => (Number.isFinite(value) ? value : null);

export async function candidateDetail(deps: ScreenerDeps, input: SpreadRequest & { debit?: unknown; lot?: unknown }): Promise<DetailSuccess | DetailFailure> {
  const request = parseSpreadRequest(deps, input);
  if (!request.ok) return { ok: false, code: 'BAD_REQUEST', message: request.message };

  let candles: Candle[] | undefined;
  let bench: Candle[] | undefined;
  if (request.source === 'synthetic') {
    const { data, bench: b } = syntheticSetup(deps);
    candles = data[request.symbol];
    bench = b;
  } else {
    candles = (await deps.store.getCandles(request.source, request.symbol))?.candles;
    bench = (await deps.store.getCandles(request.source, BENCH))?.candles ?? candles;
  }
  if (!candles?.length || !bench) return { ok: false, code: 'NO_DATA', message: 'No candles are loaded for this symbol yet. Run a scan first.' };

  const rows = addIndicators(candles, bench);
  const last = rows[rows.length - 1];
  const series = rows.slice(-260).map((r) => ({ date: r.date, close: r.close, high: r.high, low: r.low, sma20: finite(r.sma20), sma50: finite(r.sma50), sma200: finite(r.sma200), rsi: finite(r.rsi) }));

  const width = Math.abs(request.kShort - request.kLong);
  const params = DEFAULT_PARAMS;
  const call = request.side > 0;
  const liveDebit = positive(input.debit) ? input.debit : null;
  let debit = liveDebit;
  if (debit === null) {
    const iv = Math.min(Math.max(last.hv20 * 1.1, 0.15), 0.9);
    const T = params.holdDays / 252;
    debit = bs(last.close, request.kLong, T, iv, call) - bs(last.close, request.kShort, T, iv, call);
  }
  const recent = rows.slice(-10);
  const swing = request.side > 0 ? Math.min(...recent.map((r) => r.low)) : Math.max(...recent.map((r) => r.high));
  const sensible = Number.isFinite(debit) && debit > 0 && debit < width;
  return {
    ok: true,
    symbol: request.symbol,
    sector: deps.universe[request.symbol] ?? UNIVERSE[request.symbol] ?? '',
    asOf: last.date,
    lastClose: last.close,
    series,
    levels: supportResistance(rows),
    plan: sensible ? buildActionPlan({ side: request.side, debit, kLong: request.kLong, kShort: request.kShort, lot: positive(input.lot) ? input.lot : 1, expiry: request.expiry, params, lastClose: last.close, sma20: last.sma20, swing, holidays: deps.holidays }) : null,
    planBasis: liveDebit === null ? 'modelled' : 'live quote',
    planNote: sensible ? null : 'The debit is not between zero and the spread width, so no plan can be built for these strikes.',
  };
}
