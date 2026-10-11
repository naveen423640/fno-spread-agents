import { describe, expect, it } from 'vitest';

import { BOARD_CONFIG } from '@/lib/board/config';
import { atrAbs, clusterLevels, computeZones, findOrderBlocks, pivotIndices, summarize, type C5 } from '@/lib/board/zones';

const T0 = Date.parse('2026-10-09T09:15:00+05:30') / 1000;
const bar = (i: number, o: number, h: number, l: number, c: number): C5 => ({ t: T0 + i * 300, o, h, l, c, v: 1000 });
// A calm candle: range 1 around the price, so the ATR is exactly 1.
const calm = (i: number, price = 100) => bar(i, price, price + 0.5, price - 0.5, price);
const calmRun = (n: number, price = 100) => Array.from({ length: n }, (_, i) => calm(i, price));
const cfg = BOARD_CONFIG.zones;
// The synthetic paths below use 3-candle swings, so they run with that lookback rather than the 5-candle default.
const small = { ...cfg, pivotLookback: { intraday: 3, daily: 3 } };

describe('pivotIndices', () => {
  it('finds a swing high and a swing low with the lookback on both sides', () => {
    const highs = [1, 2, 3, 9, 3, 2, 1, 2, 3, 2, 1];
    expect(pivotIndices(highs, 2, 'high')).toEqual([3, 8]);
    const lows = [9, 8, 7, 1, 7, 8, 9, 8, 7, 8, 9];
    expect(pivotIndices(lows, 2, 'low')).toEqual([3, 8]);
  });
  it('does not report the edges, where there is not enough history', () => {
    expect(pivotIndices([9, 1, 2, 3], 2, 'high')).toEqual([]);
  });
  it('reports a flat top once, not on every candle of the plateau', () => {
    expect(pivotIndices([1, 2, 9, 9, 2, 1, 0], 2, 'high')).toHaveLength(1);
  });
});

describe('clusterLevels', () => {
  it('merges points within the tolerance and sums their weight', () => {
    const levels = clusterLevels([{ price: 100, weight: 1 }, { price: 100.2, weight: 2 }, { price: 105, weight: 1 }, { price: 105.1, weight: 1 }, { price: 110, weight: 1 }], 0.5);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toMatchObject({ weight: 3, low: 100, high: 100.2 });
    expect(levels[0].price).toBeCloseTo(100.133, 2); // weight-averaged
    expect(levels[1].weight).toBe(2);
    expect(levels[2].weight).toBe(1);
  });
  it('returns nothing for no points', () => { expect(clusterLevels([], 0.5)).toEqual([]); });
});

describe('atrAbs', () => {
  it('is the mean true range of the last candles', () => {
    expect(atrAbs(calmRun(20), 14)).toBeCloseTo(1, 6);
  });
  it('returns null without enough candles', () => { expect(atrAbs(calmRun(5), 14)).toBeNull(); });
});

describe('findOrderBlocks', () => {
  // 15 calm candles (ATR 1), a down candle, then a strong up move of 3 points inside three candles.
  const bullSetup = () => [...calmRun(15), bar(15, 100, 100.4, 98.6, 99), bar(16, 99, 101.5, 98.9, 101.2), bar(17, 101.2, 102.6, 101, 102.4), bar(18, 102.4, 103, 102, 102.8)];

  it('marks the last down candle before an up impulse as a bullish order block', () => {
    const blocks = findOrderBlocks(bullSetup(), cfg.orderBlock);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ side: 'bull', top: 100.4, bottom: 98.6, mitigated: false });
    expect(blocks[0].impulseAtr).toBeGreaterThan(1.5);
  });

  it('can draw the zone from the candle body instead of its full range', () => {
    const blocks = findOrderBlocks(bullSetup(), { ...cfg.orderBlock, zone: 'body' });
    expect(blocks[0]).toMatchObject({ top: 100, bottom: 99 });
  });

  it('marks the block mitigated once a later candle closes through it', () => {
    const later = [...bullSetup(), bar(19, 102.8, 103, 98, 98.2)];
    expect(findOrderBlocks(later, cfg.orderBlock)[0].mitigated).toBe(true);
  });

  it('does not mitigate on a wick through the zone, only on a close', () => {
    const later = [...bullSetup(), bar(19, 102.8, 103, 98, 100.5)];
    expect(findOrderBlocks(later, cfg.orderBlock)[0].mitigated).toBe(false);
  });

  it('marks the last up candle before a down impulse as a bearish order block', () => {
    const candles = [...calmRun(15), bar(15, 100, 101.4, 99.6, 101), bar(16, 101, 101.1, 98.5, 98.8), bar(17, 98.8, 99, 97.4, 97.6), bar(18, 97.6, 98, 97, 97.2)];
    const blocks = findOrderBlocks(candles, cfg.orderBlock);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ side: 'bear', top: 101.4, bottom: 99.6, mitigated: false });
  });

  it('ignores a move smaller than the impulse threshold', () => {
    const candles = [...calmRun(15), bar(15, 100, 100.4, 99.4, 99.6), bar(16, 99.6, 100.5, 99.5, 100.3), bar(17, 100.3, 100.9, 100.2, 100.8), bar(18, 100.8, 101, 100.6, 100.9)];
    expect(findOrderBlocks(candles, cfg.orderBlock)).toEqual([]);
  });

  it('needs the impulse to start right after the candle', () => {
    // The down candle is followed by another down candle, so the later one is the "last" opposite candle.
    const candles = [...calmRun(15), bar(15, 100, 100.4, 98.6, 99), bar(16, 99, 99.2, 98.4, 98.6), bar(17, 98.6, 101.5, 98.5, 101.4), bar(18, 101.4, 102.6, 101.2, 102.5)];
    const blocks = findOrderBlocks(candles, cfg.orderBlock);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].bottom).toBe(98.4);
  });

  it('returns nothing without enough candles for an ATR', () => { expect(findOrderBlocks(calmRun(6), cfg.orderBlock)).toEqual([]); });
});

describe('computeZones', () => {
  const daily = (date: string, high: number, low: number, close = (high + low) / 2) => ({ date, open: close, high, low, close, volume: 1 });
  // Two sessions of 5-minute candles built from price paths with clear swings.
  const path = (start: number, points: number[]) => points.map((p, i) => bar(i, p, p + 0.3, p - 0.3, p));

  it('puts levels below the price in support and above it in resistance', () => {
    const intraday = path(100, [100, 101, 102, 103, 102, 101, 100, 99, 100, 101, 102, 103, 102, 101, 100, 99, 100, 101, 102, 101]);
    const z = computeZones({ intraday, daily: [], price: 101.5, config: small });
    expect(z.resistances.every((l) => l.price > 101.5)).toBe(true);
    expect(z.supports.every((l) => l.price < 101.5)).toBe(true);
  });

  it('reports previous-day and current-day high and low as liquidity', () => {
    const intraday = [calm(0, 100), bar(1, 100, 104, 99.8, 103), calm(2, 103), calm(3, 102)];
    const z = computeZones({ intraday, daily: [daily('2026-10-08', 105, 96), daily('2026-10-09', 104, 99)], price: 102, config: small });
    const kinds = Object.fromEntries(z.liquidity.map((l) => [l.kind, l.price]));
    expect(kinds['prev-day-high']).toBe(105);
    expect(kinds['prev-day-low']).toBe(96);
    expect(kinds['day-high']).toBe(104);
    expect(kinds['day-low']).toBe(99.5);
  });

  it('finds equal highs: two swing highs within the tolerance', () => {
    const intraday = path(100, [100, 100.5, 101, 101.5, 103, 101.5, 101, 100.5, 100, 100.5, 101, 101.5, 103.1, 101.5, 101, 100.5, 100, 99.5, 99, 99]);
    const z = computeZones({ intraday, daily: [], price: 100, config: small });
    const eq = z.liquidity.filter((l) => l.kind === 'equal-highs');
    expect(eq).toHaveLength(1);
    expect(eq[0].price).toBeGreaterThan(103);
  });

  it('drops equal highs the price has already traded through, and keeps equal lows only below the price', () => {
    const intraday = path(100, [100, 100.5, 101, 101.5, 103, 101.5, 101, 100.5, 100, 100.5, 101, 101.5, 103.1, 101.5, 101, 100.5, 100, 99.5, 99, 99]);
    const above = computeZones({ intraday, daily: [], price: 104, config: small });
    expect(above.liquidity.filter((l) => l.kind === 'equal-highs')).toEqual([]); // price is above them: already taken
    expect(computeZones({ intraday, daily: [], price: 100, config: small }).liquidity.filter((l) => l.kind === 'equal-lows').every((l) => l.price < 100)).toBe(true);
  });

  it('limits equal-high/low pools to the nearest few per side', () => {
    // Five separate pairs of equal highs above the price.
    const wave: number[] = [];
    for (const peak of [105, 107, 109, 111, 113]) wave.push(100, 100.5, 101, 101.5, peak, 101.5, 101, 100.5, 100, 100.5, 101, 101.5, peak + 0.01, 101.5, 101, 100.5);
    const z = computeZones({ intraday: path(100, wave), daily: [], price: 100, config: { ...small, equalLookbackCandles: 500 } });
    const highs = z.liquidity.filter((l) => l.kind === 'equal-highs');
    expect(highs).toHaveLength(cfg.equalPerSide);
    expect(highs[0].price).toBeLessThan(highs[1].price);
  });

  it('keeps only the nearest levels per side', () => {
    const wave = Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i / 2.2));
    const z = computeZones({ intraday: path(100, wave), daily: [], price: 100, config: { ...small, minLevelWeight: 1 } });
    expect(z.supports.length).toBeLessThanOrEqual(cfg.levelsPerSide);
    expect(z.resistances.length).toBeLessThanOrEqual(cfg.levelsPerSide);
  });

  it('leaves out order blocks that are further from the price than the maximum distance', () => {
    const candles = [...calmRun(15), bar(15, 100, 100.4, 98.6, 99), bar(16, 99, 101.5, 98.9, 101.2), bar(17, 101.2, 102.6, 101, 102.4), bar(18, 102.4, 103, 102, 102.8)];
    expect(computeZones({ intraday: candles, daily: [], price: 102.8, config: small }).orderBlocks).toHaveLength(1);
    expect(computeZones({ intraday: candles, daily: [], price: 130, config: small }).orderBlocks).toEqual([]); // about 23% away
  });

  it('handles an empty candle set', () => {
    const z = computeZones({ intraday: [], daily: [], price: 100, config: small });
    expect(z).toMatchObject({ supports: [], resistances: [], liquidity: [], orderBlocks: [] });
  });
});

describe('summarize', () => {
  it('names the resistance, order block, support and liquidity levels around the price', () => {
    const text = summarize({
      supports: [{ price: 98, weight: 3, low: 97.9, high: 98.1 }], resistances: [{ price: 104, weight: 2, low: 103.9, high: 104.1 }],
      liquidity: [{ kind: 'prev-day-high', price: 105, label: 'Prev day high' }],
      orderBlocks: [{ side: 'bull', top: 100.4, bottom: 98.6, t: 0, mitigated: false, impulseAtr: 2 }], price: 101, direction: 'bull',
    });
    expect(text).toBe('Resistance 104.00, Order block 98.60 to 100.40, Support 98.00, Liquidity 105.00 (Prev day high), Price 101.00');
  });
  it('leaves out the parts it does not have', () => {
    expect(summarize({ supports: [], resistances: [], liquidity: [], orderBlocks: [], price: 50, direction: 'bear' })).toBe('Price 50.00');
  });
  it('picks liquidity on the side of the trade: highs above for a bull, lows below for a bear', () => {
    const liquidity = [
      { kind: 'equal-lows' as const, price: 103, label: 'Equal lows' }, { kind: 'prev-day-high' as const, price: 108, label: 'Prev day high' },
      { kind: 'day-low' as const, price: 99, label: 'Day low' }, { kind: 'equal-highs' as const, price: 110, label: 'Equal highs' },
    ];
    const base = { supports: [], resistances: [], orderBlocks: [], liquidity, price: 102 };
    expect(summarize({ ...base, direction: 'bull' })).toContain('Liquidity 108.00 (Prev day high)'); // not the equal lows at 103
    expect(summarize({ ...base, direction: 'bear' })).toContain('Liquidity 99.00 (Day low)');
  });
  it('picks the order block that matches the direction: demand below for bulls, supply above for bears', () => {
    const blocks = [
      { side: 'bull' as const, top: 99, bottom: 98, t: 0, mitigated: false, impulseAtr: 2 },
      { side: 'bear' as const, top: 106, bottom: 105, t: 0, mitigated: false, impulseAtr: 2 },
    ];
    expect(summarize({ supports: [], resistances: [], liquidity: [], orderBlocks: blocks, price: 102, direction: 'bull' })).toContain('Order block 98.00 to 99.00');
    expect(summarize({ supports: [], resistances: [], liquidity: [], orderBlocks: blocks, price: 102, direction: 'bear' })).toContain('Order block 105.00 to 106.00');
  });
});

import { candlesFromSnapshots, parseIntradayCandles } from '@/lib/board/candles';

describe('candle sources', () => {
  it('parses FYERS candle rows and drops malformed ones, oldest first', () => {
    const out = parseIntradayCandles([[600, 1, 2, 0.5, 1.5, 10], [300, 1, 2, 0.5, 1.2, 5], [900, 1, 2, null, 1.5, 3], 'x']);
    expect(out.map((c) => c.t)).toEqual([300, 600]);
    expect(out[0]).toEqual({ t: 300, o: 1, h: 2, l: 0.5, c: 1.2, v: 5 });
    expect(parseIntradayCandles('nope')).toEqual([]);
  });
  it('builds 5-minute candles from per-minute snapshots, with volume as the rise in the cumulative count', () => {
    const row = (ts: number, ltp: number, volume: number) => ({ symbol: 'S', ts, day: 'd', ltp, volume, oi: null, prevOi: null, open: null, high: null, low: null, prevClose: null, vwap: null });
    const out = candlesFromSnapshots([row(0, 100, 1000), row(60, 101, 1200), row(120, 99, 1500), row(300, 102, 1600), row(360, 103, 1900)]);
    expect(out).toEqual([{ t: 0, o: 100, h: 101, l: 99, c: 99, v: 500 }, { t: 300, o: 102, h: 103, l: 102, c: 103, v: 400 }]);
  });
});
