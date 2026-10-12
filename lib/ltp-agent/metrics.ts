// Performance numbers over a list of per-trade net P&L (rupees, after costs), given in the order the trades closed.
import type { Metrics } from './experiment-types';

export function metricsOf(nets: number[]): Metrics {
  if (!nets.length) return { n: 0, winRate: 0, expectancy: 0, profitFactor: 0, maxDrawdown: 0, netPnl: 0 };
  const wins = nets.filter((x) => x > 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -nets.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const x of nets) { running += x; peak = Math.max(peak, running); maxDrawdown = Math.max(maxDrawdown, peak - running); }
  const net = nets.reduce((a, b) => a + b, 0);
  // A null profit factor means there was no losing trade, so it is unbounded.
  return { n: nets.length, winRate: wins.length / nets.length, expectancy: net / nets.length, profitFactor: grossLoss === 0 ? (grossWin > 0 ? null : 0) : grossWin / grossLoss, maxDrawdown, netPnl: net };
}

// The share of the random runs that the candidate beats (strictly), as a percent. Null when there were no random runs.
export function percentileOf(value: number, samples: number[]): number | null {
  if (!samples.length) return null;
  return (samples.filter((s) => s < value).length / samples.length) * 100;
}
