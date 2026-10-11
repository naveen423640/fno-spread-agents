// Runs a configured backtest over loaded history. Pure given its inputs, so the CLI and the app share it.
import { gainersLosersBaseline, openToCloseBaseline, prepareMonth, randomEntryBaseline, type BaselineStats, type PreparedDay } from './baselines';
import type { BacktestConfig } from './config';
import { simulateDay } from './engine';
import type { SymbolMonth, SkippedMonth } from './history';
import { computeSummary, distribution, equityCurve, heatmap, sliceBy, SLICES, type SliceRow, type Summary } from './metrics';
import { priceTrade, type PricedTrade, type PricingContext } from './pricing';
import { bootstrapMeanCI, mean, pValueAgainst } from './stats';
import type { SymbolMaster } from './symbol-master';
import type { ExitRule, SignalFilters } from './types';

export type StrategyResult = {
  name: string; rule: ExitRule;
  all: Summary; train: Summary; holdout: Summary | null;
  expectancyPctCI: { all: { low: number; high: number } | null; holdout: { low: number; high: number } | null };
  random: { runs: number; tradesPerRun: number; p5: number | null; median: number | null; p95: number | null; pValue: number | null; holdoutPValue: number | null } | null;
  slices: Record<string, SliceRow[]>;
  equity: { t: number; equity: number }[];
  distribution: { edges: number[]; counts: number[] };
  heatmap: ReturnType<typeof heatmap>;
  skippedByPortfolio: number;
  exitReasons: Record<string, number>;
};
export type GridResult = { combinations: number; tried: { params: Record<string, unknown>; trainTrades: number; trainExpectancyPct: number | null }[]; best: { params: Record<string, unknown>; train: Summary; holdout: Summary | null } | null; note: string };
export type BacktestResult = {
  generatedAt: string; config: BacktestConfig;
  range: { from: string; to: string; sessions: number; months: string[]; trainMonths: string[]; holdoutMonths: string[] };
  symbols: number; skipped: SkippedMonth[];
  strategies: StrategyResult[];
  baselines: { openToClose: { all: ReturnType<typeof openToCloseBaseline>; holdout: ReturnType<typeof openToCloseBaseline> | null }; gainersLosers: { all: BaselineStats; holdout: BaselineStats | null } };
  grid: GridResult | null;
  warnings: string[];
};
export type BacktestOutput = { result: BacktestResult; trades: PricedTrade[] };

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);

// Keeps trades in entry order, skipping any that would break the concurrent-position or margin limits.
export function applyPortfolioLimits(trades: PricedTrade[], limits: { maxConcurrent: number | null; marginPct: number; marginCap: number | null }): { kept: PricedTrade[]; skipped: number } {
  if (limits.maxConcurrent === null && limits.marginCap === null) return { kept: trades, skipped: 0 };
  const kept: PricedTrade[] = [];
  let open: PricedTrade[] = [];
  let skipped = 0;
  for (const t of [...trades].sort((a, b) => a.entryT - b.entryT)) {
    open = open.filter((o) => o.exitT > t.entryT);
    const margin = open.reduce((a, o) => a + o.notional * limits.marginPct, 0) + t.notional * limits.marginPct;
    if ((limits.maxConcurrent !== null && open.length >= limits.maxConcurrent) || (limits.marginCap !== null && margin > limits.marginCap)) { skipped += 1; continue; }
    open.push(t); kept.push(t);
  }
  return { kept, skipped };
}

export function pricingContext(config: BacktestConfig, master: SymbolMaster, data: SymbolMonth[], kind = config.instrument): PricingContext {
  const closes = new Map<string, Map<string, number>>();
  for (const sm of data) {
    const byDay = closes.get(sm.entry.symbol) ?? new Map<string, number>();
    for (const [day, candles] of sm.days) byDay.set(day, candles[candles.length - 1].c);
    closes.set(sm.entry.symbol, byDay);
  }
  return { kind, slippageBps: config.slippageBps, capitalPerTrade: config.capitalPerTrade, lots: master.lots, strikes: master.strikes, closes, iv: config.iv, riskFreeRate: 0.065, fallbackLot: null };
}

function tradesFor(prepared: PreparedDay[], rule: ExitRule, filters: SignalFilters, ctx: PricingContext, config: BacktestConfig): { trades: PricedTrade[]; skippedByPortfolio: number; unpriced: number } {
  const priced: PricedTrade[] = [];
  let unpriced = 0;
  for (const d of prepared) {
    if (d.day < config.from || d.day > config.to) continue;
    for (const raw of simulateDay({ day: d.day, month: d.month, sessionOfMonth: d.sessionOfMonth, symbol: d.symbol, sector: d.sector, candles: d.candles, prior: d.prior }, rule, filters, undefined, d.events)) {
      const p = priceTrade(raw, ctx);
      if (p) priced.push(p); else unpriced += 1;
    }
  }
  const { kept, skipped } = applyPortfolioLimits(priced, config.portfolio);
  return { trades: kept, skippedByPortfolio: skipped, unpriced };
}

function comboList(grid: NonNullable<BacktestConfig['grid']>): Record<string, unknown>[] {
  let combos: Record<string, unknown>[] = [{}];
  for (const [key, values] of Object.entries(grid)) {
    if (!values?.length) continue;
    combos = combos.flatMap((c) => (values as unknown[]).map((v) => ({ ...c, [key]: v })));
  }
  return combos;
}

export function runBacktest(config: BacktestConfig, data: SymbolMonth[], skipped: SkippedMonth[], master: SymbolMaster, now = new Date()): BacktestOutput {
  const ctx = pricingContext(config, master, data);
  const futuresCtx = config.instrument === 'futures' ? ctx : pricingContext(config, master, data, 'futures');
  const prepared = data.flatMap((sm) => prepareMonth(sm.entry.symbol, sm.entry.sector, sm.month, sm.days));
  const inRange = prepared.filter((d) => d.day >= config.from && d.day <= config.to);
  const allDays = [...new Set(inRange.map((d) => d.day))].sort();
  const months = [...new Set(inRange.map((d) => d.month))].sort();
  const holdoutCount = months.length >= 2 ? Math.max(1, Math.round(months.length * config.holdoutFraction)) : 0;
  const holdoutMonths = months.slice(months.length - holdoutCount);
  const trainMonths = months.slice(0, months.length - holdoutCount);
  const isHoldout = (t: { month: string }) => holdoutMonths.includes(t.month);
  const daysOf = (ms: string[]) => allDays.filter((d) => ms.includes(d.slice(0, 7)));
  const holdoutPrepared = inRange.filter((d) => holdoutMonths.includes(d.month));

  const strategies: StrategyResult[] = config.exits.map((rule, i) => {
    const { trades, skippedByPortfolio } = tradesFor(prepared, rule, config.filters, ctx, config);
    const holdout = trades.filter(isHoldout);
    const train = trades.filter((t) => !isHoldout(t));
    // Random baseline uses futures-style trades so it is comparable on net percent per trade.
    let random: StrategyResult['random'] = null;
    if (config.randomRuns > 0 && trades.length) {
      const futuresTrades = config.instrument === 'futures' ? trades : tradesFor(prepared, rule, config.filters, futuresCtx, config).trades;
      const all = randomEntryBaseline(inRange, futuresTrades, rule, futuresCtx, config.randomRuns, config.seed + i);
      const hold = holdout.length ? randomEntryBaseline(holdoutPrepared, futuresTrades.filter(isHoldout), rule, futuresCtx, Math.max(50, Math.floor(config.randomRuns / 2)), config.seed + 100 + i) : null;
      const sorted = [...all.runMeans].sort((a, b) => a - b);
      const stratMean = futuresTrades.length ? mean(futuresTrades.map((t) => t.netPct)) : 0;
      const holdMean = futuresTrades.filter(isHoldout).length ? mean(futuresTrades.filter(isHoldout).map((t) => t.netPct)) : null;
      random = { runs: all.runMeans.length, tradesPerRun: all.tradesPerRun, p5: pct(sorted, 0.05), median: pct(sorted, 0.5), p95: pct(sorted, 0.95), pValue: pValueAgainst(stratMean, all.runMeans), holdoutPValue: hold && holdMean !== null ? pValueAgainst(holdMean, hold.runMeans) : null };
    }
    const exitReasons: Record<string, number> = {};
    for (const t of trades) exitReasons[t.exitReason] = (exitReasons[t.exitReason] ?? 0) + 1;
    return {
      name: rule.name, rule, all: computeSummary(trades, allDays), train: computeSummary(train, daysOf(trainMonths)), holdout: holdout.length || holdoutCount ? computeSummary(holdout, daysOf(holdoutMonths)) : null,
      expectancyPctCI: { all: bootstrapMeanCI(trades.map((t) => t.netPct), config.bootstrapIterations, config.seed), holdout: bootstrapMeanCI(holdout.map((t) => t.netPct), config.bootstrapIterations, config.seed + 1) },
      random, slices: Object.fromEntries(Object.entries(SLICES).map(([k, fn]) => [k, sliceBy(trades, fn)])), equity: equityCurve(trades), distribution: distribution(trades), heatmap: heatmap(trades), skippedByPortfolio, exitReasons,
    };
  });

  // Every strategy's trades, for the saved trade log.
  const trades = config.exits.flatMap((rule) => tradesFor(prepared, rule, config.filters, ctx, config).trades);

  const openToClose = openToCloseBaseline(inRange, config.squareoffAt, futuresCtx);
  const gl = gainersLosersBaseline(inRange, config.gainersLosersTopN, config.squareoffAt, futuresCtx);
  const baselines: BacktestResult['baselines'] = {
    openToClose: { all: openToClose, holdout: holdoutPrepared.length ? openToCloseBaseline(holdoutPrepared, config.squareoffAt, futuresCtx) : null },
    gainersLosers: { all: gl, holdout: holdoutPrepared.length ? gainersLosersBaseline(holdoutPrepared, config.gainersLosersTopN, config.squareoffAt, futuresCtx) : null },
  };

  // Optional grid search: choose parameters on the training months only, then show the hold-out result right beside them.
  let grid: GridResult | null = null;
  if (config.grid) {
    const combos = comboList(config.grid);
    const tried: GridResult['tried'] = [];
    let best: { params: Record<string, unknown>; trainTrades: PricedTrade[]; holdoutTrades: PricedTrade[]; score: number } | null = null;
    for (const params of combos) {
      const rule: ExitRule = { name: `grid-${JSON.stringify(params)}`, squareoffAt: config.squareoffAt, stopPct: params.stopPct as number | undefined, targetR: params.targetR as number | undefined, trailPct: params.trailPct as number | undefined };
      const filters: SignalFilters = { ...config.filters, ...(params.entryTo ? { entryTo: params.entryTo as string } : {}), ...(params.firstCrossOnly !== undefined ? { firstCrossOnly: params.firstCrossOnly as boolean } : {}), ...(params.skipBorderline !== undefined ? { skipBorderline: params.skipBorderline as boolean } : {}), ...(params.minDistancePct !== undefined ? { minDistancePct: params.minDistancePct as number } : {}) };
      const all = tradesFor(prepared, rule, filters, ctx, config).trades;
      const train = all.filter((t) => !isHoldout(t));
      const expectancy = train.length ? mean(train.map((t) => t.netPct)) : null;
      tried.push({ params, trainTrades: train.length, trainExpectancyPct: expectancy });
      if (train.length >= 30 && expectancy !== null && (!best || expectancy > best.score)) best = { params, trainTrades: train, holdoutTrades: all.filter(isHoldout), score: expectancy };
    }
    grid = {
      combinations: combos.length, tried, best: best ? { params: best.params, train: computeSummary(best.trainTrades, daysOf(trainMonths)), holdout: holdoutCount ? computeSummary(best.holdoutTrades, daysOf(holdoutMonths)) : null } : null,
      note: `${combos.length} parameter combinations were tried on the training months. The best of that many looks better in-sample than it really is; only the hold-out result next to it is a fair estimate.`,
    };
  }

  const warnings: string[] = [];
  if (allDays.length < 60) warnings.push(`Only ${allDays.length} trading sessions in range. That is thin: treat every number as indicative at best.`);
  if (!holdoutCount) warnings.push('Fewer than 2 usable months, so there is no hold-out. Every result here is in-sample.');
  else warnings.push(`Hold-out = the last ${holdoutCount} month(s) (${holdoutMonths.join(', ')}); parameters were never chosen on them unless the grid note says otherwise.`);
  const exitCount = config.exits.length + (grid?.combinations ?? 0);
  warnings.push(`${exitCount} exit configurations were evaluated side by side. The best of several always looks better than it will in practice (multiple testing).`);
  warnings.push("Survivorship bias: the stock list is today's constituents (no point-in-time membership is available), so names that left the index in this period are missing.");
  warnings.push("Lot sizes come from today's FYERS symbol master and are applied to past dates; lot sizes change over time. Percent returns do not depend on them.");
  warnings.push('Costs use the rates in lib/vwap/backtest/costs.ts (verified from public sources on 2026-10-12, not from a contract note). Brokerage is a flat Rs 20 per order.');
  if (config.instrument === 'option') warnings.push('Option P&L is MODELLED with Black-Scholes (realised-vol IV, 6.5% rate, last-Tuesday expiry): expired option candles are not available. It is not real traded premium. Baselines are futures-style.');
  if (skipped.length) warnings.push(`${skipped.length} symbol-month(s) were skipped (incomplete month or possible corporate action); see the list.`);
  const unreliableHoliday = 'The first-session check for each month uses the repo holiday list, which is marked unverified.';
  warnings.push(unreliableHoliday);

  return {
    trades,
    result: {
      generatedAt: now.toISOString(), config, range: { from: config.from, to: config.to, sessions: allDays.length, months, trainMonths, holdoutMonths },
      symbols: new Set(data.map((d) => d.entry.symbol)).size, skipped, strategies, baselines, grid, warnings,
    },
  };
}
