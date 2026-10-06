import { UNIVERSE } from './config';
import type { Candle } from './types';

// Seeded synthetic candles for dry runs and tests. Same recipe as synthetic() in the reference script (random-walk drift,
// a slow regime term, noisy open/high/low), but a different random generator, so the numbers are not the same as numpy's.
// For testing the code only; it says nothing about any market.

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

function normal(rng: () => number, mean = 0, sd = 1): number {
  const u = Math.max(rng(), 1e-12);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function weekdaysEnding(endDate: string, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(`${endDate}T00:00:00Z`);
  while (dates.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates;
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

function series(dates: string[], rng: () => number): Candle[] {
  const drift = normal(rng, 0.0004, 0.0004);
  const vol = 0.012 + rng() * (0.025 - 0.012);
  let regime = 0;
  let level = Math.log(100);
  return dates.map((date) => {
    regime += normal(rng, 0, 0.15);
    level += drift + 0.0005 * Math.sin(regime) + normal(rng, 0, vol);
    const close = Math.exp(level);
    const open = close * (1 + normal(rng, 0, 0.004));
    const high = Math.max(open, close) * (1 + Math.abs(normal(rng, 0, 0.006)));
    const low = Math.min(open, close) * (1 - Math.abs(normal(rng, 0, 0.006)));
    return { date, open: r4(open), high: r4(high), low: r4(low), close: r4(close), volume: Math.round(5e5 + rng() * 1.5e6) };
  });
}

export type SyntheticOptions = { stocks: number; days: number; seed: number; endDate: string };

export function makeSynthetic(options: SyntheticOptions): { data: Record<string, Candle[]>; bench: Candle[] } {
  const dates = weekdaysEnding(options.endDate, options.days);
  const names = Object.keys(UNIVERSE).slice(0, options.stocks);
  const data = Object.fromEntries(names.map((name, i) => [name, series(dates, mulberry32(options.seed * 1000 + i))]));
  return { data, bench: series(dates, mulberry32(options.seed * 1000 + 999)) };
}
