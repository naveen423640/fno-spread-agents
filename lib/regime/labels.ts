import { REGIME_CONFIG } from './config';
import type { Label, LabelWindow, Method } from './types';

function sampleStd(values: number[]) {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1));
}

export function labelSeries(closes: number[], window: LabelWindow, method: Method) {
  const labels: Label[] = Array(closes.length).fill(null);
  const metric: (number | null)[] = Array(closes.length).fill(null);
  const logReturns = closes.map((close, i) => (i === 0 ? Number.NaN : Math.log(close / closes[i - 1])));
  const lookback = REGIME_CONFIG.volLookback;

  for (let t = 0; t < closes.length; t += 1) {
    if (t < window) continue;
    if (method === 'fixed') {
      const p = closes[t] / closes[t - window] - 1;
      metric[t] = p;
      labels[t] = p > REGIME_CONFIG.fixedThreshold ? 'Bull' : p < -REGIME_CONFIG.fixedThreshold ? 'Bear' : 'Sideways';
      continue;
    }
    if (t < lookback + 1) continue;
    const sigma = sampleStd(logReturns.slice(t - lookback, t));
    if (!Number.isFinite(sigma) || sigma <= 0) continue;
    const z = Math.log(closes[t] / closes[t - window]) / (sigma * Math.sqrt(window));
    metric[t] = z;
    labels[t] = z > REGIME_CONFIG.volThreshold ? 'Bull' : z < -REGIME_CONFIG.volThreshold ? 'Bear' : 'Sideways';
  }
  return { labels, metric };
}
