// Seeded randomness, bootstrap confidence intervals and a permutation test, so results are reproducible.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

export function stdev(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

// Percentile bootstrap of the mean: resample with replacement, take the middle (1 - alpha) of the resampled means.
export function bootstrapMeanCI(values: number[], iterations: number, seed: number, alpha = 0.05): { low: number; high: number } | null {
  if (values.length < 5) return null;
  const rand = rng(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let k = 0; k < values.length; k += 1) sum += values[Math.floor(rand() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return { low: means[Math.floor((alpha / 2) * iterations)], high: means[Math.min(iterations - 1, Math.floor((1 - alpha / 2) * iterations))] };
}

// One-sided permutation-style p-value: the share of baseline results at least as good as the strategy's, with the strategy counted once.
export function pValueAgainst(strategyValue: number, baselineValues: number[]): number | null {
  if (!baselineValues.length) return null;
  return (1 + baselineValues.filter((b) => b >= strategyValue).length) / (baselineValues.length + 1);
}
