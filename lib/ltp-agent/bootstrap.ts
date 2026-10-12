// A seeded bootstrap of the difference in mean P&L per trade between two samples, so the same data and seed always give the same interval.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function bootstrapDiff(a: number[], b: number[], seed: number, iterations = 5000): { mean: number; lo90: number; hi90: number } {
  if (!a.length || !b.length) return { mean: 0, lo90: 0, hi90: 0 };
  const rand = mulberry32(seed);
  const resample = (xs: number[]) => { let sum = 0; for (let i = 0; i < xs.length; i += 1) sum += xs[Math.floor(rand() * xs.length)]; return sum / xs.length; };
  const diffs: number[] = [];
  for (let i = 0; i < iterations; i += 1) diffs.push(resample(a) - resample(b));
  diffs.sort((x, y) => x - y);
  return { mean: mean(a) - mean(b), lo90: diffs[Math.floor(0.05 * (iterations - 1))], hi90: diffs[Math.ceil(0.95 * (iterations - 1))] };
}
