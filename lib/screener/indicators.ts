import type { Candle, IndRow } from './types';

// Port of add_indicators() in screener/fo_spread_screener.py. Values the pandas version leaves as NaN are NaN here.

function rollingMean(values: number[], window: number): number[] {
  return values.map((_, i) => {
    if (i < window - 1) return Number.NaN;
    let sum = 0;
    for (let k = i - window + 1; k <= i; k += 1) sum += values[k];
    return sum / window;
  });
}

// Sample standard deviation (ddof = 1), NaN when the window holds a NaN, like pandas rolling().std().
function rollingStd(values: number[], window: number): number[] {
  return values.map((_, i) => {
    if (i < window - 1) return Number.NaN;
    const slice = values.slice(i - window + 1, i + 1);
    if (slice.some(Number.isNaN)) return Number.NaN;
    const mean = slice.reduce((a, b) => a + b, 0) / window;
    return Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (window - 1));
  });
}

// pandas ewm(alpha, adjust=False).mean(): leading NaNs stay NaN, the first valid value seeds the recursion.
function ewm(values: number[], alpha: number): number[] {
  const out: number[] = [];
  let prev = Number.NaN;
  for (const x of values) {
    if (!Number.isNaN(x)) prev = Number.isNaN(prev) ? x : (1 - alpha) * prev + alpha * x;
    out.push(prev);
  }
  return out;
}

const pctChange = (values: number[], lag: number) => values.map((v, i) => (i < lag ? Number.NaN : v / values[i - lag] - 1));

export function addIndicators(candles: Candle[], bench: Candle[]): IndRow[] {
  const close = candles.map((c) => c.close);
  const sma = (n: number) => rollingMean(close, n);
  const sma20 = sma(20);
  const sma50 = sma(50);
  const sma200 = sma(200);

  const delta = close.map((c, i) => (i === 0 ? Number.NaN : c - close[i - 1]));
  const ru = ewm(delta.map((d) => (Number.isNaN(d) ? d : Math.max(d, 0))), 1 / 14);
  const rd = ewm(delta.map((d) => (Number.isNaN(d) ? d : -Math.min(d, 0))), 1 / 14);
  const rsi = ru.map((u, i) => 100 - 100 / (1 + u / rd[i]));

  const benchPct = pctChange(bench.map((c) => c.close), 63);
  const benchByDate = new Map(bench.map((c, i) => [c.date, benchPct[i]]));
  const stockPct = pctChange(close, 63);
  const rs63 = stockPct.map((v, i) => v - (benchByDate.get(candles[i].date) ?? Number.NaN));

  const volMean = rollingMean(candles.map((c) => c.volume), 20);
  const volRatio = candles.map((c, i) => c.volume / volMean[i]);

  const logReturn = close.map((c, i) => (i === 0 ? Number.NaN : Math.log(c / close[i - 1])));
  const hv20 = rollingStd(logReturn, 20).map((s) => s * Math.sqrt(252));
  const hvPct = hv20.map((latest, i) => {
    if (i < 251) return Number.NaN;
    const window = hv20.slice(i - 251, i + 1);
    if (window.some(Number.isNaN)) return Number.NaN;
    return window.filter((x) => x <= latest).length / 252;
  });

  return candles.map((c, i) => ({
    ...c,
    sma20: sma20[i],
    sma50: sma50[i],
    sma200: sma200[i],
    rsi: rsi[i],
    rs63: rs63[i],
    volRatio: volRatio[i],
    hv20: hv20[i],
    hvPct: hvPct[i],
    prevHigh: i === 0 ? Number.NaN : candles[i - 1].high,
    prevLow: i === 0 ? Number.NaN : candles[i - 1].low,
  }));
}
