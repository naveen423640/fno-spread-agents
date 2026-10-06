import { readFileSync } from 'node:fs';

import type { Candle } from '../../lib/screener/types';

type Series = { dates: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
export type GoldenTrade = { sym: string; entry: string; days: number; why: string; R: number | null; risk_pct_spot: number | null };
export type GoldenScanRow = { symbol: string; sector: string; side: string; status: string; close: number; rsi: number; rs63_pct: number; vol_x: number; hv_pctile: number; long_strike_approx: number; short_strike_approx: number };
export type Golden = {
  universe: Record<string, string>;
  params: Record<string, number | number[]>;
  data: Record<string, Series>;
  indicator_index: number[];
  indicators: Record<string, Record<string, (number | null)[]>>;
  masks: Record<string, Record<string, number[]>>;
  simulate: { variant: string; sym: string; i: number; side: 1 | -1; result: { entry: string; days: number; why: string; R: number | null; risk_pct_spot: number } | null }[];
  backtest: Record<string, { trades: GoldenTrade[]; stats: Record<string, number | null>; first_half?: Record<string, number | null>; second_half?: Record<string, number | null> }>;
  scans: { end: number; raw: GoldenScanRow[]; fixed_order: GoldenScanRow[]; reference_order: GoldenScanRow[] }[];
  expiry: { today: string; expiry: string }[];
  fy_opt: { sym: string; yy: number; mon: string; strike: number; cp: string; out: string }[];
  bs: { S: number; K: number; T: number; sig: number; call: boolean; out: number }[];
  nice_step: { p: number; out: number }[];
};

let cached: Golden | null = null;
export function loadGolden(): Golden {
  cached ??= JSON.parse(readFileSync('tests/fixtures/screener/golden.json', 'utf8')) as Golden;
  return cached;
}

export function candlesOf(golden: Golden, symbol: string): Candle[] {
  const s = golden.data[symbol];
  return s.dates.map((date, i) => ({ date, open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i], volume: s.v[i] }));
}

// Equal when both are NaN (expected null), or within a relative/absolute tolerance.
export function closeTo(actual: number, expected: number | null, tolerance = 1e-9): boolean {
  if (expected === null) return Number.isNaN(actual);
  if (Number.isNaN(actual)) return false;
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}
