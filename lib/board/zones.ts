import type { Candle } from '@/lib/screener/types';

// Support/resistance, liquidity and order-block detection from candles. Pure: no clock, no I/O.

export type C5 = { t: number; o: number; h: number; l: number; c: number; v: number }; // t is unix seconds

export type Level = { price: number; weight: number; low: number; high: number };
export type LiquidityKind = 'equal-highs' | 'equal-lows' | 'prev-day-high' | 'prev-day-low' | 'day-high' | 'day-low';
export type LiquidityLevel = { kind: LiquidityKind; price: number; label: string };
export type OrderBlock = { side: 'bull' | 'bear'; top: number; bottom: number; t: number; mitigated: boolean; impulseAtr: number };
export type ZoneSet = { supports: Level[]; resistances: Level[]; liquidity: LiquidityLevel[]; orderBlocks: OrderBlock[] };

type OrderBlockConfig = { atrPeriod: number; impulseAtrMultiple: number; impulseWindow: number; zone: string; maxPerSide: number; maxDistancePct: number };
// Plain numbers, so a caller can pass BOARD_CONFIG.zones or a tuned copy of it.
export type ZoneConfig = {
  pivotLookback: { intraday: number; daily: number };
  levelTolerancePct: number; minLevelWeight: number; levelsPerSide: number;
  equalTolerancePct: number; equalMinPoints: number; equalLookbackCandles: number; equalPerSide: number;
  orderBlock: OrderBlockConfig;
};

// Indices that beat `lookback` values on each side. A pivot must exceed everything to its left and match or exceed everything to
// its right, so a flat top is reported once. The first and last `lookback` values can never be pivots.
export function pivotIndices(values: number[], lookback: number, kind: 'high' | 'low'): number[] {
  const out: number[] = [];
  const better = kind === 'high' ? (a: number, b: number) => a > b : (a: number, b: number) => a < b;
  const notWorse = kind === 'high' ? (a: number, b: number) => a >= b : (a: number, b: number) => a <= b;
  for (let i = lookback; i <= values.length - lookback - 1; i += 1) {
    let ok = true;
    for (let k = 1; k <= lookback && ok; k += 1) ok = better(values[i], values[i - k]) && notWorse(values[i], values[i + k]);
    if (ok) out.push(i);
  }
  return out;
}

// Greedy 1-D clustering: sorted points join the running cluster while within tolPct of its weighted mean.
export function clusterLevels(points: { price: number; weight: number }[], tolPct: number): Level[] {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const levels: Level[] = [];
  let sum = 0, weight = 0, low = 0, high = 0;
  const flush = () => { if (weight > 0) levels.push({ price: sum / weight, weight, low, high }); };
  for (const p of sorted) {
    const mean = weight > 0 ? sum / weight : p.price;
    if (weight > 0 && Math.abs(p.price - mean) / mean * 100 > tolPct) { flush(); sum = 0; weight = 0; }
    if (weight === 0) { low = p.price; high = p.price; }
    sum += p.price * p.weight; weight += p.weight; low = Math.min(low, p.price); high = Math.max(high, p.price);
  }
  flush();
  return levels;
}

const trueRange = (c: C5, previousClose: number) => Math.max(c.h - c.l, Math.abs(c.h - previousClose), Math.abs(c.l - previousClose));

// Mean true range of the `period` candles ending at index `end` (inclusive); needs period + 1 candles up to there.
function atrEndingAt(candles: C5[], end: number, period: number): number | null {
  if (end < period || end >= candles.length) return null;
  let sum = 0;
  for (let i = end - period + 1; i <= end; i += 1) sum += trueRange(candles[i], candles[i - 1].c);
  return sum / period;
}

export function atrAbs(candles: C5[], period: number): number | null {
  return atrEndingAt(candles, candles.length - 1, period);
}

// Order block: the last opposite-coloured candle before an impulse. A bullish block is a down candle followed at once by an up
// candle, where price closes more than `impulseAtrMultiple` ATRs above that candle's close within `impulseWindow` candles. The
// ATR is measured on the candles before the block, so the impulse itself does not inflate the threshold. A block is mitigated
// once a later candle (after the impulse) closes through it: below the bottom for a bullish block, above the top for a bearish one.
export function findOrderBlocks(candles: C5[], cfg: OrderBlockConfig): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  for (let i = cfg.atrPeriod + 1; i < candles.length - 1; i += 1) {
    const c = candles[i];
    const next = candles[i + 1];
    const side: 'bull' | 'bear' | null = c.c < c.o && next.c > next.o ? 'bull' : c.c > c.o && next.c < next.o ? 'bear' : null;
    if (!side) continue;
    const atr = atrEndingAt(candles, i - 1, cfg.atrPeriod);
    if (!atr || atr <= 0) continue;
    let impulseEnd = -1;
    let move = 0;
    for (let k = i + 1; k <= Math.min(i + cfg.impulseWindow, candles.length - 1); k += 1) {
      const m = side === 'bull' ? candles[k].c - c.c : c.c - candles[k].c;
      if (m > cfg.impulseAtrMultiple * atr) { impulseEnd = k; move = m; break; }
    }
    if (impulseEnd < 0) continue;
    const top = cfg.zone === 'body' ? Math.max(c.o, c.c) : c.h;
    const bottom = cfg.zone === 'body' ? Math.min(c.o, c.c) : c.l;
    let mitigated = false;
    for (let k = impulseEnd + 1; k < candles.length && !mitigated; k += 1) mitigated = side === 'bull' ? candles[k].c < bottom : candles[k].c > top;
    blocks.push({ side, top, bottom, t: c.t, mitigated, impulseAtr: move / atr });
  }
  return blocks;
}

const istDate = (epochSeconds: number) => new Date(epochSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function computeZones(input: { intraday: C5[]; daily: Candle[]; price: number; config: ZoneConfig }): ZoneSet {
  const { intraday, daily, price, config } = input;
  const swings: { price: number; weight: number; side: 'high' | 'low' }[] = [];
  for (const i of pivotIndices(intraday.map((c) => c.h), config.pivotLookback.intraday, 'high')) swings.push({ price: intraday[i].h, weight: 1, side: 'high' });
  for (const i of pivotIndices(intraday.map((c) => c.l), config.pivotLookback.intraday, 'low')) swings.push({ price: intraday[i].l, weight: 1, side: 'low' });
  for (const i of pivotIndices(daily.map((c) => c.high), config.pivotLookback.daily, 'high')) swings.push({ price: daily[i].high, weight: 2, side: 'high' });
  for (const i of pivotIndices(daily.map((c) => c.low), config.pivotLookback.daily, 'low')) swings.push({ price: daily[i].low, weight: 2, side: 'low' });

  const levels = clusterLevels(swings, config.levelTolerancePct).filter((l) => l.weight >= config.minLevelWeight);
  const supports = levels.filter((l) => l.price < price).sort((a, b) => b.price - a.price).slice(0, config.levelsPerSide);
  const resistances = levels.filter((l) => l.price > price).sort((a, b) => a.price - b.price).slice(0, config.levelsPerSide);

  const liquidity: LiquidityLevel[] = [];
  // Equal highs/lows are pools of resting orders. Only ones price has not yet traded through are kept: equal highs above the
  // price and equal lows below it, from recent swings, nearest first. Ones already passed have been taken.
  const recentFrom = Math.max(0, intraday.length - config.equalLookbackCandles);
  const equal = (kind: 'equal-highs' | 'equal-lows', label: string) => {
    const side = kind === 'equal-highs' ? 'high' : 'low';
    const idx = pivotIndices(intraday.map((c) => (side === 'high' ? c.h : c.l)), config.pivotLookback.intraday, side).filter((i) => i >= recentFrom);
    const points = idx.map((i) => ({ price: side === 'high' ? intraday[i].h : intraday[i].l, weight: 1 }));
    const pools = clusterLevels(points, config.equalTolerancePct)
      .filter((l) => l.weight >= config.equalMinPoints)
      .map((l) => (side === 'high' ? l.high : l.low))
      .filter((p) => (side === 'high' ? p > price : p < price))
      .sort((a, b) => Math.abs(a - price) - Math.abs(b - price))
      .slice(0, config.equalPerSide);
    for (const p of pools) liquidity.push({ kind, price: p, label });
  };
  equal('equal-highs', 'Equal highs');
  equal('equal-lows', 'Equal lows');

  if (intraday.length) {
    const sessionDay = istDate(intraday[intraday.length - 1].t);
    const today = intraday.filter((c) => istDate(c.t) === sessionDay);
    liquidity.push({ kind: 'day-high', price: Math.max(...today.map((c) => c.h)), label: 'Day high' }, { kind: 'day-low', price: Math.min(...today.map((c) => c.l)), label: 'Day low' });
    const previous = [...daily].reverse().find((c) => c.date < sessionDay);
    if (previous) liquidity.push({ kind: 'prev-day-high', price: previous.high, label: 'Prev day high' }, { kind: 'prev-day-low', price: previous.low, label: 'Prev day low' });
  }

  const near = (b: OrderBlock) => (b.side === 'bull' ? Math.max(0, price - b.top) : Math.max(0, b.bottom - price)) / price * 100 <= config.orderBlock.maxDistancePct;
  const blocks = findOrderBlocks(intraday, config.orderBlock).filter((b) => !b.mitigated && near(b)).sort((a, b) => b.t - a.t);
  const orderBlocks = [...blocks.filter((b) => b.side === 'bull').slice(0, config.orderBlock.maxPerSide), ...blocks.filter((b) => b.side === 'bear').slice(0, config.orderBlock.maxPerSide)];
  return { supports, resistances, liquidity, orderBlocks };
}

const f = (v: number) => v.toFixed(2);

// One line for the detail view. The order block shown is the one that matches the setup: nearest bullish (demand) block at or
// below the price for a bull, nearest bearish (supply) block at or above it for a bear. Liquidity is the nearest pool in the
// direction of the trade (highs above the price for a bull, lows below it for a bear), else the nearest level of any kind.
export function summarize(input: ZoneSet & { price: number; direction: 'bull' | 'bear' }): string {
  const { price, direction } = input;
  const parts: string[] = [];
  if (input.resistances[0]) parts.push(`Resistance ${f(input.resistances[0].price)}`);
  const candidates = input.orderBlocks.filter((b) => !b.mitigated && b.side === direction && (direction === 'bull' ? b.bottom <= price : b.top >= price));
  const block = candidates.sort((a, b) => (direction === 'bull' ? price - a.top - (price - b.top) : a.bottom - price - (b.bottom - price)))[0];
  if (block) parts.push(`Order block ${f(block.bottom)} to ${f(block.top)}`);
  if (input.supports[0]) parts.push(`Support ${f(input.supports[0].price)}`);
  const highKinds = new Set<LiquidityKind>(['equal-highs', 'day-high', 'prev-day-high']);
  const lowKinds = new Set<LiquidityKind>(['equal-lows', 'day-low', 'prev-day-low']);
  const nearestFirst = (a: LiquidityLevel, b: LiquidityLevel) => Math.abs(a.price - price) - Math.abs(b.price - price);
  const inDirection = input.liquidity.filter((l) => (direction === 'bull' ? highKinds.has(l.kind) && l.price > price : lowKinds.has(l.kind) && l.price < price)).sort(nearestFirst)[0];
  const liq = inDirection ?? input.liquidity.slice().sort(nearestFirst)[0];
  if (liq) parts.push(`Liquidity ${f(liq.price)} (${liq.label})`);
  parts.push(`Price ${f(price)}`);
  return parts.join(', ');
}
