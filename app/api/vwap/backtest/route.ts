import { getDatabaseBinding } from '@/db';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { parseConfig, type BacktestConfig } from '@/lib/vwap/backtest/config';
import { createCachingProvider, loadHistory } from '@/lib/vwap/backtest/history';
import { createMonthCacheProvider } from '@/lib/vwap/backtest/month-cache';
import { runBacktest, type BacktestResult } from '@/lib/vwap/backtest/run';
import { loadSymbolMaster, type SymbolMaster } from '@/lib/vwap/backtest/symbol-master';
import { createBoardCacheProvider } from '@/lib/vwap/cache-provider';
import { assertPaperOnly } from '@/lib/execution-mode';
import { createFyersProvider } from '@/lib/vwap/provider';
import { createVwapStore } from '@/lib/vwap/store';
import { loadUniverse } from '@/lib/vwap/universe';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_SYMBOLS = 60; // the app runs the backtest inside one request; bigger universes belong in the CLI
const MAX_TRADES_RETURNED = 6000;
const LOAD_SLICE = 8;
const memory = globalThis as typeof globalThis & { __vwapBacktest?: { result: BacktestResult; trades: unknown[]; tradesTruncated: boolean; at: string }; __vwapMaster?: SymbolMaster };

const slim = (t: import('@/lib/vwap/backtest/pricing').PricedTrade) => ({
  strategy: t.strategy, ticker: t.ticker, sector: t.sector, day: t.day, direction: t.direction, signalType: t.signalType, borderline: t.borderline, entryT: t.entryT, entryPrice: t.entryPrice,
  exitT: t.exitT, exitPrice: t.exitPrice, exitReason: t.exitReason, holdMinutes: t.holdMinutes, maePct: t.maePct, mfePct: t.mfePct, qty: t.qty, grossPnl: t.grossPnl, costs: t.costs.total, netPnl: t.netPnl, netPct: t.netPct, modelled: t.modelled,
});

async function configFrom(body: Record<string, unknown> | null): Promise<BacktestConfig> {
  const raw = (body?.config && typeof body.config === 'object' ? body.config : {}) as Record<string, unknown>;
  const config = parseConfig({ ...raw, randomRuns: Math.min(200, Number(raw.randomRuns ?? 100) || 100), bootstrapIterations: Math.min(2000, Number(raw.bootstrapIterations ?? 1000) || 1000), grid: null });
  return config;
}

export async function GET() {
  const last = memory.__vwapBacktest;
  return Response.json(last ? { result: last.result, trades: last.trades, tradesTruncated: last.tradesTruncated, at: last.at } : { result: null }, { headers: NO_STORE });
}

// POST { action: 'load', config, offset }: fetch the next few symbols' months from FYERS into the cache. POST { action: 'run', config }: replay cached data.
export async function POST(request: Request) {
  try {
    assertPaperOnly();
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    let config: BacktestConfig;
    try { config = await configFrom(body); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid configuration.' }, { status: 400, headers: NO_STORE }); }
    const db = getDatabaseBinding();
    const store = createVwapStore(db);
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    let entries;
    try { entries = await loadUniverse(config.universe, { store, today }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unknown universe.' }, { status: 400, headers: NO_STORE }); }
    if (entries.length > MAX_SYMBOLS) return Response.json({ error: `This universe has ${entries.length} symbols. The app runs up to ${MAX_SYMBOLS} at a time; use the CLI (npm run vwap:backtest) for larger universes.` }, { status: 400, headers: NO_STORE });

    if (body?.action === 'load') {
      const credentials = fyersCredentials(request);
      if (!credentials) return Response.json({ loginRequired: true, error: 'Connect FYERS first.' }, { status: 401, headers: NO_STORE });
      const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
      const slice = entries.slice(offset, offset + LOAD_SLICE);
      const provider = createCachingProvider(createFyersProvider({ credentials }), db, today);
      const out = await loadHistory({ provider, entries: slice, from: config.from, to: config.to, concurrency: 4 });
      if (out.loginRequired) return Response.json({ loginRequired: true, error: 'The FYERS login has expired. Sign in again.' }, { status: 401, headers: NO_STORE });
      return Response.json({ total: entries.length, loaded: Math.min(entries.length, offset + slice.length), done: offset + slice.length >= entries.length, errors: out.errors }, { headers: NO_STORE });
    }

    if (body?.action === 'run') {
      const provider = config.source === 'cache' ? createBoardCacheProvider(db) : createMonthCacheProvider(db);
      const history = await loadHistory({ provider, entries, from: config.from, to: config.to, concurrency: 6 });
      if (!history.data.length) return Response.json({ error: `No usable history for this range. ${config.source === 'fyers' ? 'Load the data first. ' : ''}${history.skipped.slice(0, 3).map((s) => `${s.symbol} ${s.month}: ${s.reason}`).join('; ')}` }, { status: 422, headers: NO_STORE });
      memory.__vwapMaster ??= await loadSymbolMaster();
      const { result, trades } = runBacktest(config, history.data, history.skipped, memory.__vwapMaster, now);
      const truncated = trades.length > MAX_TRADES_RETURNED;
      const slimmed = [...trades].sort((a, b) => a.entryT - b.entryT).slice(0, MAX_TRADES_RETURNED).map(slim);
      memory.__vwapBacktest = { result, trades: slimmed, tradesTruncated: truncated, at: now.toISOString() };
      return Response.json({ result, trades: slimmed, tradesTruncated: truncated, at: now.toISOString() }, { headers: NO_STORE });
    }
    return Response.json({ error: 'Unknown action.' }, { status: 400, headers: NO_STORE });
  } catch (error) {
    console.error('vwap backtest failed', error);
    return Response.json({ error: 'The backtest failed.' }, { status: 500, headers: NO_STORE });
  }
}
