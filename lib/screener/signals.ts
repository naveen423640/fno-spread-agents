import type { ScreenerParams } from './config';
import type { IndRow, Side } from './types';

// Port of parts_bull / parts_bear / sig_bull / sig_bear / VARIANTS in screener/fo_spread_screener.py.
// Comparisons with NaN are false, which is how pandas masks behave after .fillna(False).

export type Parts = [trend: boolean, relativeStrength: boolean, pullback: boolean, trigger: boolean, volatilityOk: boolean];

export function partsBull(d: IndRow, p: ScreenerParams): Parts {
  const [lo, hi] = p.rsiBull;
  return [
    d.close > d.sma200 && d.sma50 > d.sma200,
    d.rs63 > 0,
    d.rsi >= lo && d.rsi <= hi && d.close <= d.sma20 * p.nearMaUp && d.close >= d.sma50 * p.nearMaLo,
    d.close > d.prevHigh,
    d.hvPct <= p.hvPctMax,
  ];
}

export function partsBear(d: IndRow, p: ScreenerParams): Parts {
  const [lo, hi] = p.rsiBear;
  return [
    d.close < d.sma200 && d.sma50 < d.sma200,
    d.rs63 < 0,
    d.rsi >= lo && d.rsi <= hi && d.close >= d.sma20 * (2 - p.nearMaUp) && d.close <= d.sma50 * (2 - p.nearMaLo),
    d.close < d.prevLow,
    d.hvPct <= p.hvPctMax,
  ];
}

export const sigBull = (d: IndRow, p: ScreenerParams) => partsBull(d, p).every(Boolean);
export const sigBear = (d: IndRow, p: ScreenerParams) => partsBear(d, p).every(Boolean);

export type Variant = { side: Side; fn: (d: IndRow, p: ScreenerParams) => boolean };

export const VARIANTS: Record<string, Variant> = {
  bull_full: { side: 1, fn: sigBull },
  bull_no_trigger: { side: 1, fn: (d, p) => { const [t, r, pull, , v] = partsBull(d, p); return t && r && pull && v; } },
  'oversold_only (RSI<30)': { side: 1, fn: (d) => d.rsi < 30 },
  oversold_in_uptrend: { side: 1, fn: (d) => d.rsi < 35 && d.close > d.sma200 },
  uptrend_baseline: { side: 1, fn: (d) => d.close > d.sma200 && d.sma50 > d.sma200 },
  bear_full: { side: -1, fn: sigBear },
};
