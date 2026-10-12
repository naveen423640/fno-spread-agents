import { describe, expect, it } from 'vitest';

import { gainersLosersBaseline, openToCloseBaseline, prepareMonth, randomEntryBaseline } from '@/lib/vwap/backtest/baselines';
import { DEFAULT_CONFIG, parseConfig } from '@/lib/vwap/backtest/config';
import { corporateActionIn, createCachingProvider, expectedFirstSession, loadHistory, monthsBetween } from '@/lib/vwap/backtest/history';
import { computeSummary, distribution, equityCurve, heatmap, sliceBy } from '@/lib/vwap/backtest/metrics';
import { DEFAULT_IV, type PricedTrade, type PricingContext } from '@/lib/vwap/backtest/pricing';
import { applyPortfolioLimits, runBacktest } from '@/lib/vwap/backtest/run';
import { bootstrapMeanCI, pValueAgainst } from '@/lib/vwap/backtest/stats';
import type { SymbolMaster } from '@/lib/vwap/backtest/symbol-master';
import type { C5 } from '@/lib/vwap/core';
import type { DataProvider } from '@/lib/vwap/provider';
import { createD1Fake } from '../support/d1-fake';

const fake = (over: Partial<PricedTrade>): PricedTrade => ({
  strategy: 's', symbol: 'NSE:X-EQ', sector: 'IT', day: '2026-10-05', month: '2026-10', direction: 1, signalType: 'close-cross', borderline: false, signalT: 0, signalDistancePct: 0.2, entryT: 1000, entryPrice: 100, exitT: 2000, exitPrice: 101,
  exitReason: 'square-off', maePct: -0.1, mfePct: 0.5, holdMinutes: 30, dayOfMonth: 5, sessionOfMonth: 3, ticker: 'X', instrument: 'futures', modelled: false, lot: 1, lots: 1, qty: 1, entryFill: 100, exitFill: 101, notional: 100,
  grossPnl: 0, costs: { total: 0 }, netPnl: 0, netPct: 0, ...over,
});

describe('summary metrics on a hand-computable set', () => {
  // Three trades: +100, -50, +30 rupees on two days; a third day has no trades.
  const trades = [
    fake({ day: '2026-10-05', exitT: 100, netPnl: 100, grossPnl: 110, costs: { total: 10 }, netPct: 1 }),
    fake({ day: '2026-10-05', exitT: 200, netPnl: -50, grossPnl: -45, costs: { total: 5 }, netPct: -0.5 }),
    fake({ day: '2026-10-06', exitT: 300, netPnl: 30, grossPnl: 35, costs: { total: 5 }, netPct: 0.3 }),
  ];
  const s = computeSummary(trades, ['2026-10-05', '2026-10-06', '2026-10-07']);

  it('win rate, average win and loss, expectancy and profit factor', () => {
    expect(s.trades).toBe(3);
    expect(s.winRate).toBeCloseTo(2 / 3, 10);
    expect(s.avgWinRs).toBe(65);
    expect(s.avgLossRs).toBe(-50);
    expect(s.expectancyRs).toBeCloseTo(80 / 3, 10);
    expect(s.expectancyPct).toBeCloseTo(0.8 / 3, 10);
    expect(s.profitFactor).toBeCloseTo(130 / 50, 10);
    expect(s.totalPnl).toBe(80);
    expect(s.grossPnl).toBe(100);
    expect(s.totalCosts).toBe(20);
  });

  it('max drawdown is the biggest fall from a running peak: 100 down to 50', () => {
    expect(s.maxDrawdown).toBe(50);
  });

  it('daily Sharpe uses zero for days with no trades', () => {
    const daily = [50, 30, 0];
    const m = 80 / 3;
    const sd = Math.sqrt(daily.reduce((a, d) => a + (d - m) ** 2, 0) / 2);
    expect(s.sharpeDaily).toBeCloseTo((m / sd) * Math.sqrt(252), 8);
  });

  it('has no profit factor without a loss, and an empty summary has no averages', () => {
    expect(computeSummary([fake({ netPnl: 10 })], ['2026-10-05']).profitFactor).toBeNull();
    const empty = computeSummary([], ['2026-10-05']);
    expect(empty).toMatchObject({ trades: 0, winRate: null, expectancyRs: null, totalPnl: 0 });
  });

  it('equity curve, distribution and slices', () => {
    expect(equityCurve(trades).map((p) => p.equity)).toEqual([100, 50, 80]);
    const d = distribution(trades, 4);
    expect(d.counts.reduce((a, b) => a + b, 0)).toBe(3);
    const rows = sliceBy([...trades, fake({ direction: -1, netPnl: 5, netPct: 0.1 })], (t) => (t.direction === 1 ? 'long' : 'short'));
    expect(rows.find((r) => r.key === 'long')!.trades).toBe(3);
    expect(rows.find((r) => r.key === 'short')!.totalPnl).toBe(5);
    expect(heatmap(trades).cols).toEqual(['1-5', '6-10']);
  });
});

describe('portfolio limits', () => {
  const t = (entryT: number, exitT: number) => fake({ entryT, exitT, notional: 1000 });
  it('skips a trade that would exceed the concurrent-position limit', () => {
    const { kept, skipped } = applyPortfolioLimits([t(1, 10), t(2, 5), t(11, 20)], { maxConcurrent: 1, marginPct: 0.15, marginCap: null });
    expect(kept.map((x) => x.entryT)).toEqual([1, 11]);
    expect(skipped).toBe(1);
  });
  it('enforces a margin cap using notional x margin percent', () => {
    const { kept } = applyPortfolioLimits([t(1, 10), t(2, 10), t(3, 10)], { maxConcurrent: null, marginPct: 0.1, marginCap: 250 }); // 100 per trade
    expect(kept).toHaveLength(2);
  });
  it('does nothing without limits', () => {
    expect(applyPortfolioLimits([t(1, 10), t(2, 10)], { maxConcurrent: null, marginPct: 0.15, marginCap: null }).skipped).toBe(0);
  });
});

describe('statistics', () => {
  it('bootstrap is reproducible for a seed, brackets the mean, and collapses for identical values', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = bootstrapMeanCI(values, 1000, 7)!;
    expect(bootstrapMeanCI(values, 1000, 7)).toEqual(a);
    expect(a.low).toBeLessThan(5.5);
    expect(a.high).toBeGreaterThan(5.5);
    expect(bootstrapMeanCI([3, 3, 3, 3, 3], 200, 1)).toEqual({ low: 3, high: 3 });
    expect(bootstrapMeanCI([1, 2], 100, 1)).toBeNull();
  });
  it('p-value counts baseline runs at least as good as the strategy, with the strategy itself counted once', () => {
    expect(pValueAgainst(10, [1, 2, 3, 4])).toBeCloseTo(1 / 5, 10);
    expect(pValueAgainst(0, [1, 2, 3, 4])).toBeCloseTo(5 / 5, 10);
    expect(pValueAgainst(2.5, [1, 2, 3, 4])).toBeCloseTo(3 / 5, 10);
    expect(pValueAgainst(1, [])).toBeNull();
  });
});

describe('config', () => {
  it('fills defaults and keeps every exit flat by the global square-off', () => {
    const c = parseConfig({ universe: 'nifty_it', from: '2026-08-01', to: '2026-10-09', squareoffAt: '15:10', exits: [{ name: 'a' }, { name: 'b', squareoffAt: '14:00' }, { name: 'c', squareoffAt: '15:20' }] });
    expect(c.exits.map((e) => e.squareoffAt)).toEqual(['15:10', '14:00', '15:10']);
    expect(c.filters.types).toHaveLength(3);
  });
  it('rejects bad input with a clear message', () => {
    expect(() => parseConfig({ from: '2026-10-09', to: '2026-08-01' })).toThrow(/from and to/);
    expect(() => parseConfig({ filters: { types: ['nope'] } })).toThrow(/filters.types/);
    expect(() => parseConfig({ exits: [{ name: 'x', targetR: 2 }] })).toThrow(/targetR needs stopPct/);
    expect(() => parseConfig({ exits: [{ name: 'x' }, { name: 'x' }] })).toThrow(/unique name/);
    expect(() => parseConfig({ instrument: 'swap' })).toThrow(/instrument/);
    expect(() => parseConfig({ grid: { stopPct: Array.from({ length: 15 }, (_, i) => i + 1), targetR: Array.from({ length: 15 }, (_, i) => i + 1) } })).toThrow(/200 or fewer/);
  });
});

describe('history loading', () => {
  const T = (day: string, i: number) => Date.parse(`${day}T09:15:00+05:30`) / 1000 + i * 300;
  const session = (day: string, price: number, v = 100): C5[] => Array.from({ length: 5 }, (_, i) => ({ t: T(day, i), o: price, h: price, l: price, c: price, v }));
  const entry = { ticker: 'TCS', symbol: 'NSE:TCS-EQ', name: 'TCS', sector: 'IT' };
  const providerOf = (candles: C5[]): DataProvider => ({ name: 'fake', candles5m: async (_s, from, to) => ({ ok: true as const, value: candles.filter((c) => { const d = new Date((c.t + 19800) * 1000).toISOString().slice(0, 10); return d >= from && d <= to; }) }) });

  it('lists the calendar months in a range and finds the expected first session', () => {
    expect(monthsBetween('2026-08-15', '2026-10-09')).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(expectedFirstSession('2026-08')).toBe('2026-08-03'); // 1 August 2026 is a Saturday
    expect(expectedFirstSession('2026-10')).toBe('2026-10-01');
  });

  it('keeps complete months and skips a month whose data starts after the month opened', async () => {
    const candles = [...session('2026-08-03', 100), ...session('2026-08-04', 100), ...session('2026-09-03', 100), ...session('2026-09-04', 100)]; // September data starts on the 3rd, but 1 September was a Tuesday
    const out = await loadHistory({ provider: providerOf(candles), entries: [entry], from: '2026-08-01', to: '2026-09-30' });
    expect(out.data.map((d) => d.month)).toEqual(['2026-08']);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]).toMatchObject({ month: '2026-09' });
    expect(out.skipped[0].reason).toMatch(/history starts 2026-09-03 but the month opens 2026-09-01/);
  });

  it('skips a symbol-month with a split-like gap and no volume spike, but not one with a volume spike', () => {
    const split = new Map([['2026-08-03', session('2026-08-03', 1000)], ['2026-08-04', session('2026-08-04', 500)]]);
    expect(corporateActionIn(split)).toMatch(/possible split/);
    const earnings = new Map([['2026-08-03', session('2026-08-03', 1000)], ['2026-08-04', session('2026-08-04', 700, 1000)]]);
    expect(corporateActionIn(earnings)).toBeNull();
  });

  it('reports months with no candles and stops cleanly on an expired login', async () => {
    const empty = await loadHistory({ provider: providerOf([]), entries: [entry], from: '2026-08-01', to: '2026-08-31' });
    expect(empty.skipped[0].reason).toBe('no candles');
    const expired: DataProvider = { name: 'x', candles5m: async () => ({ ok: false, code: 'LOGIN_REQUIRED', message: 'expired' }) };
    expect((await loadHistory({ provider: expired, entries: [entry], from: '2026-08-01', to: '2026-08-31' })).loginRequired).toBe(true);
  });

  it('the caching provider fetches a finished month once and serves it from the cache afterwards', async () => {
    let calls = 0;
    const inner: DataProvider = { name: 'inner', candles5m: async (s, f, t) => { calls += 1; return providerOf([...session('2026-08-03', 100), ...session('2026-08-04', 101)]).candles5m(s, f, t); } };
    const cached = createCachingProvider(inner, createD1Fake(['drizzle/0007_vwap_history.sql']), '2026-10-12');
    const first = await cached.candles5m('NSE:TCS-EQ', '2026-08-01', '2026-08-31');
    const second = await cached.candles5m('NSE:TCS-EQ', '2026-08-01', '2026-08-31');
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    expect(first.ok && first.value).toHaveLength(10);
  });

  it('the caching provider never stores the day in progress', async () => {
    const inner = providerOf([...session('2026-10-01', 100), ...session('2026-10-12', 101)]);
    const db = createD1Fake(['drizzle/0007_vwap_history.sql']);
    const cached = createCachingProvider(inner, db, '2026-10-12');
    await cached.candles5m('NSE:TCS-EQ', '2026-10-01', '2026-10-12');
    const row = await db.prepare('SELECT through, candles_json FROM vwap_m5_month WHERE symbol = ?').bind('NSE:TCS-EQ').first<{ through: string; candles_json: string }>();
    expect(row!.through).toBe('2026-10-11');
    expect((JSON.parse(row!.candles_json) as unknown[]).length).toBe(5); // only 1 October
  });
});

// A day with a known shape: 10 flat candles at 100 (the VWAP sits at 100), then a candle opening at 100 and closing at 101 (a body-cross up),
// then flat at 101. The signal is on candle 10, so the entry is at candle 11's open of 101.
const shapedDay = (day: string): C5[] => {
  const t = (i: number) => Date.parse(`${day}T09:15:00+05:30`) / 1000 + i * 300;
  return Array.from({ length: 75 }, (_, i) => (i < 10 ? { t: t(i), o: 100, h: 100, l: 100, c: 100, v: 100 } : i === 10 ? { t: t(i), o: 100, h: 101.2, l: 100, c: 101, v: 100 } : { t: t(i), o: 101, h: 101, l: 101, c: 101, v: 100 }));
};
const master: SymbolMaster = { lots: new Map([['TCS', 100]]), strikes: new Map(), expiry: new Map() };
const entry = { ticker: 'TCS', symbol: 'NSE:TCS-EQ', name: 'TCS', sector: 'IT' };
const oneDayMonths = ['2026-08-03', '2026-09-01', '2026-10-01'].map((day) => ({ entry, month: day.slice(0, 7), days: new Map([[day, shapedDay(day)]]) }));
const cfg = (over: Record<string, unknown> = {}) => parseConfig({ universe: 'custom:TCS', from: '2026-08-01', to: '2026-10-09', slippageBps: 0, randomRuns: 20, bootstrapIterations: 200, exits: [{ name: 'hold-to-1515', squareoffAt: '15:15' }, { name: 'wide-stop', stopPct: 10, targetR: 5 }], ...over });

describe('runBacktest on a hand-computable dataset', () => {
  it('trades once per month, enters at the next open, and the P&L is exactly the cost of a flat round trip', () => {
    const { result, trades } = runBacktest(cfg(), oneDayMonths, [], master);
    const hold = result.strategies.find((s) => s.name === 'hold-to-1515')!;
    expect(hold.all.trades).toBe(3);
    const t = trades.filter((x) => x.strategy === 'hold-to-1515')[0];
    expect(t).toMatchObject({ direction: 1, signalType: 'body-cross', entryPrice: 101, exitPrice: 101, exitReason: 'square-off', qty: 100 });
    // Bought and sold at 101 for 100 shares: no price P&L, so the net loss is exactly the costs.
    // brokerage 40; exchange and SEBI on 20,200; STT 0.05% of 10,100; stamp 0.002% of 10,100; GST 18% of brokerage + exchange + SEBI.
    const costs = 40 + 20_200 * 0.000019 + 20_200 * 0.000001 + 10_100 * 0.0005 + 10_100 * 0.00002 + 0.18 * (40 + 20_200 * 0.000019 + 20_200 * 0.000001);
    expect(t.grossPnl).toBeCloseTo(0, 10);
    expect(t.netPnl).toBeCloseTo(-costs, 6);
    expect(hold.all.totalPnl).toBeCloseTo(-3 * costs, 5);
  });

  it('splits the months into training and hold-out, and always shows the hold-out beside the training result', () => {
    const { result } = runBacktest(cfg(), oneDayMonths, [], master);
    expect(result.range.months).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(result.range.holdoutMonths).toEqual(['2026-10']);
    expect(result.range.trainMonths).toEqual(['2026-08', '2026-09']);
    const s = result.strategies[0];
    expect(s.train.trades).toBe(2);
    expect(s.holdout!.trades).toBe(1);
  });

  it('warns that three sessions are not enough, and that the best of several rules is flattered', () => {
    const { result } = runBacktest(cfg(), oneDayMonths, [], master);
    expect(result.warnings.join(' ')).toMatch(/Only 3 trading sessions/);
    expect(result.warnings.join(' ')).toMatch(/multiple testing/);
    expect(result.warnings.join(' ')).toMatch(/Survivorship bias/);
  });

  it('has no hold-out with a single month, and says so', () => {
    const { result } = runBacktest(cfg(), [oneDayMonths[0]], [], master);
    expect(result.range.holdoutMonths).toEqual([]);
    expect(result.strategies[0].holdout).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/no hold-out/);
  });

  it('is reproducible: the same seed gives the same result', () => {
    const a = runBacktest(cfg({ seed: 5 }), oneDayMonths, [], master, new Date(0)).result;
    const b = runBacktest(cfg({ seed: 5 }), oneDayMonths, [], master, new Date(0)).result;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('only counts days inside the requested range, though the month before it still feeds the VWAP', () => {
    const { result } = runBacktest(cfg({ from: '2026-09-01', to: '2026-10-09' }), oneDayMonths, [], master);
    expect(result.strategies[0].all.trades).toBe(2);
    expect(result.range.months).toEqual(['2026-09', '2026-10']);
  });

  it('a grid search always reports the hold-out next to the chosen parameters, and counts every combination', () => {
    const many = Array.from({ length: 4 }, (_, i) => ['2026-08-03', '2026-09-01', '2026-10-01', '2026-11-02'].map((day) => ({ entry: { ...entry, ticker: `S${i}`, symbol: `NSE:S${i}-EQ` }, month: day.slice(0, 7), days: new Map([[day, shapedDay(day)]]) }))).flat();
    const m: SymbolMaster = { lots: new Map(Array.from({ length: 4 }, (_, i) => [`S${i}`, 100] as [string, number])), strikes: new Map(), expiry: new Map() };
    // 4 months x 4 symbols = 16 trades; the grid needs 30 training trades to pick a winner, so use more symbols.
    const lots = new Map(m.lots);
    const wide = Array.from({ length: 12 }, (_, i) => ['2026-08-03', '2026-09-01', '2026-10-01', '2026-11-02'].map((day) => { lots.set(`W${i}`, 100); return { entry: { ...entry, ticker: `W${i}`, symbol: `NSE:W${i}-EQ` }, month: day.slice(0, 7), days: new Map([[day, shapedDay(day)]]) }; })).flat();
    const { result } = runBacktest(cfg({ to: '2026-11-30', exits: [{ name: 'x', squareoffAt: '15:15' }], grid: { stopPct: [1, 2], targetR: [1, 2], skipBorderline: [false, true] } }), [...many, ...wide], [], { ...m, lots });
    expect(result.grid!.combinations).toBe(8);
    expect(result.grid!.tried).toHaveLength(8);
    expect(result.grid!.best).not.toBeNull();
    expect(result.grid!.best!.holdout).not.toBeNull();
    expect(result.grid!.note).toMatch(/8 parameter combinations/);
    expect(result.warnings.join(' ')).toMatch(/9 exit configurations/);
  });
});

describe('option instrument', () => {
  it('prices every trade and every baseline with the same modelled option, and says so', () => {
    const m: SymbolMaster = { lots: new Map([['TCS', 100]]), strikes: new Map([['TCS', [90, 95, 100, 105, 110, 115]]]), expiry: new Map() };
    const { result, trades } = runBacktest(cfg({ instrument: 'option', minOptionPremium: 0 }), oneDayMonths, [], m);
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.every((t) => t.modelled && t.instrument === 'option' && t.option)).toBe(true);
    expect(result.strategies[0].random).not.toBeNull();
    expect(result.strategies[0].random!.metric).toBe('net Rs per trade');
    expect(result.baselines.openToClose.all.long.n).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toMatch(/MODELLED/);
  });
});

describe('baselines', () => {
  const ctx: PricingContext = { kind: 'futures', slippageBps: 0, capitalPerTrade: null, lots: new Map([['TCS', 100]]), strikes: new Map(), closes: new Map(), iv: DEFAULT_IV, riskFreeRate: 0.065, fallbackLot: null, minOptionPremium: 0 };
  const prepared = oneDayMonths.flatMap((m) => prepareMonth('NSE:TCS-EQ', 'IT', m.month, m.days));

  it('buying at 09:30 wins on a day that rises 1% from 100, and selling loses by about the same', () => {
    const r = openToCloseBaseline(prepared, '15:15', ctx);
    expect(r.long.n).toBe(3);
    expect(r.short.n).toBe(3);
    // 100 -> 101 on 100 shares is +100 gross on 10,000 notional (1%), less about 0.53% of costs on this small trade.
    expect(r.long.meanNetPct!).toBeCloseTo(1 - 0.53, 1);
    expect(r.short.meanNetPct!).toBeLessThan(-1);
    expect(r.both.n).toBe(6);
  });

  it('random entries are reproducible for a seed and give one mean per run', () => {
    const strategyTrades = [fake({ symbol: 'NSE:TCS-EQ', day: '2026-08-03', entryT: prepared[0].candles[11].t })];
    const a = randomEntryBaseline(prepared, strategyTrades, { name: 'r', squareoffAt: '15:15' }, ctx, 10, 3);
    const b = randomEntryBaseline(prepared, strategyTrades, { name: 'r', squareoffAt: '15:15' }, ctx, 10, 3);
    expect(a.runMeans).toHaveLength(10);
    expect(a).toEqual(b);
  });

  it('with the index filter, random entries follow the index side instead of flipping a coin', () => {
    const sidesAll = (side: 1 | -1) => (d: (typeof prepared)[number]) => ({ ...d, indexSides: d.candles.map(() => side) });
    const strategyTrades = [fake({ symbol: 'NSE:TCS-EQ', day: '2026-08-03', entryT: prepared[0].candles[11].t })];
    const rule = { name: 'r', squareoffAt: '15:15' };
    // The day rises from 100 to 101 after the entry candle: following an up index makes money, following a down index loses.
    const up = randomEntryBaseline(prepared.map(sidesAll(1)), strategyTrades, rule, ctx, 20, 3, (t) => t.grossPnl, true);
    const down = randomEntryBaseline(prepared.map(sidesAll(-1)), strategyTrades, rule, ctx, 20, 3, (t) => t.grossPnl, true);
    expect(up.runMeans.every((m) => m >= 0)).toBe(true);
    expect(down.runMeans.every((m) => m <= 0)).toBe(true);
    // No reading at that candle: the strategy could not have entered, so the baseline does not either.
    const none = randomEntryBaseline(prepared.map((d) => ({ ...d, indexSides: d.candles.map(() => null) })), strategyTrades, rule, ctx, 5, 3, (t) => t.grossPnl, true);
    expect(none.runMeans).toEqual([]);
  });

  it('gainers and losers need enough symbols on the day', () => {
    expect(gainersLosersBaseline(prepared, 3, '15:15', ctx).n).toBe(0); // one symbol cannot fill three gainers and three losers
  });
});

void DEFAULT_CONFIG;
