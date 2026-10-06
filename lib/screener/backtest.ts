import type { ScreenerParams } from './config';
import { addIndicators } from './indicators';
import { erf, pyRound } from './numeric';
import { VARIANTS } from './signals';
import type { Candle, IndRow, Side, Trade, TradeStats } from './types';

// Port of ncdf, bs, simulate, backtest and stats in screener/fo_spread_screener.py.
// Options are modelled with Black-Scholes and an IV proxy (1.1 x 20-day realised vol), so results are indicative only.

const ncdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

export function bs(S: number, K: number, T: number, sig: number, call = true, r = 0.065): number {
  if (T <= 0) return call ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * sig * sig) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  if (call) return S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2);
  return K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
}

export type SimulatedTrade = Pick<Trade, 'entry' | 'days' | 'why' | 'R' | 'riskPctSpot'>;

// Enter at the next session's open, ATM long leg and short leg one expected move away; exit on take-profit,
// premium stop or the time stop. Returns null when there is no room, or the modelled debit is outside 5%-80% of width.
export function simulate(rows: IndRow[], i: number, side: Side, p: ScreenerParams): SimulatedTrade | null {
  const hold = p.holdDays;
  const left = p.timeExitLeft;
  const e = i + 1;
  if (e + hold >= rows.length) return null;
  const S0 = rows[e].open;
  const iv = Math.min(Math.max(rows[i].hv20 * 1.1, 0.15), 0.9);
  const T0 = hold / 252;
  const em = iv * Math.sqrt(T0);
  const K1 = S0;
  const K2 = S0 * (1 + side * em);
  const call = side > 0;
  const debit = bs(S0, K1, T0, iv, call) - bs(S0, K2, T0, iv, call);
  const width = Math.abs(K2 - K1);
  if (debit <= 0.05 * width || debit >= 0.8 * width) return null;
  const cost = debit * (1 + p.slippage);
  for (let k = 0; k <= hold - left; k += 1) {
    const S = rows[e + k].close;
    const T = Math.max((hold - k - 0.5) / 252, 1e-6);
    const net = (bs(S, K1, T, iv, call) - bs(S, K2, T, iv, call)) * (1 - p.slippage);
    let why: SimulatedTrade['why'] | null = null;
    if (net >= cost + p.takeProfit * (width - cost)) why = 'TP';
    else if (net <= (1 - p.stopLoss) * cost) why = 'SL';
    else if (k === hold - left) why = 'TIME';
    if (why) return { entry: rows[e].date, days: k + 1, why, R: (net - cost) / cost, riskPctSpot: (cost / S0) * 100 };
  }
  return null;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function stats(trades: Trade[]): TradeStats {
  if (!trades.length) return { n: 0 };
  const wins = trades.filter((t) => t.R > 0).map((t) => t.R);
  const losses = trades.filter((t) => t.R <= 0).map((t) => t.R);
  const profitFactor = losses.length && sum(losses) < 0 ? sum(wins) / -sum(losses) : Number.NaN;
  return {
    n: trades.length,
    winRate: pyRound((wins.length / trades.length) * 100, 1),
    avgWinR: wins.length ? pyRound(mean(wins), 2) : 0,
    avgLossR: losses.length ? pyRound(mean(losses), 2) : 0,
    expectancyR: pyRound(mean(trades.map((t) => t.R)), 3),
    profitFactor: Number.isNaN(profitFactor) ? null : pyRound(profitFactor, 2),
  };
}

// First half = entries before the median entry date, second half = from it onward (the robustness check in the rules).
export function halfStats(trades: Trade[]): { firstHalf: TradeStats; secondHalf: TradeStats } {
  if (!trades.length) return { firstHalf: { n: 0 }, secondHalf: { n: 0 } };
  const mid = trades.map((t) => t.entry).sort()[Math.floor(trades.length / 2)];
  return { firstHalf: stats(trades.filter((t) => t.entry < mid)), secondHalf: stats(trades.filter((t) => t.entry >= mid)) };
}

export type VariantResult = { name: string; side: Side; trades: Trade[]; stats: TradeStats; firstHalf?: TradeStats; secondHalf?: TradeStats };

export function runBacktest(data: Record<string, Candle[]>, bench: Candle[], p: ScreenerParams, onProgress?: (done: number, total: number) => void): VariantResult[] {
  const indicators = Object.entries(data)
    .filter(([symbol]) => symbol !== '^NSEI')
    .map(([symbol, candles]) => [symbol, addIndicators(candles, bench)] as const);
  const variants = Object.entries(VARIANTS);
  const results: VariantResult[] = [];
  variants.forEach(([name, variant], index) => {
    const trades: Trade[] = [];
    for (const [symbol, rows] of indicators) {
      let busy = -1;
      for (let i = 0; i < rows.length; i += 1) {
        if (!variant.fn(rows[i], p) || i <= busy || i < 260) continue;
        const result = simulate(rows, i, variant.side, p);
        if (result) {
          trades.push({ sym: symbol, variant: name, ...result });
          busy = i + 1 + result.days;
        }
      }
    }
    const halves = trades.length ? halfStats(trades) : {};
    results.push({ name, side: variant.side, trades, stats: stats(trades), ...halves });
    onProgress?.(index + 1, variants.length);
  });
  return results;
}
