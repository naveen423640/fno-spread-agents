import { describe, expect, it } from 'vitest';

import { BOARD_CONFIG } from '@/lib/board/config';
import { atrPercent, avgVolume, countCrossings, expectedVolume, scoreStock } from '@/lib/board/score';
import type { ScoreInput } from '@/lib/board/types';

const base: ScoreInput = {
  price: 102, prevClose: 100, atrPct: 2, volume: 2_000_000, expectedVolume: 1_000_000, oiChangePct: 4, sectorChangePct: 1,
  minutesElapsed: 120, dayHigh: 102.5, dayLow: 99.8, vwapCrossings: 0, openCrossings: 1,
};

describe('scoreStock', () => {
  it('scores a strong long build-up with sector support as bullish', () => {
    const r = scoreStock(base);
    expect(r.direction).toBe('bull');
    expect(r.score).toBeGreaterThan(50);
    expect(r.oi).toBe('long buildup');
    expect(r.filtered).toBeNull();
    expect(r.moveAtr).toBeCloseTo(1, 5); // +2% on a 2% ATR stock is one ATR
  });

  it('mirrors a down move with rising OI into a bearish short build-up', () => {
    const r = scoreStock({ ...base, price: 98, sectorChangePct: -1, dayHigh: 100.2, dayLow: 97.5 });
    expect(r.direction).toBe('bear');
    expect(r.score).toBeLessThan(-50);
    expect(r.oi).toBe('short buildup');
  });

  it('normalises by ATR: the same 2% move ranks higher on a low-volatility stock', () => {
    const calm = scoreStock({ ...base, atrPct: 1 });
    const wild = scoreStock({ ...base, atrPct: 4 });
    expect(calm.score).toBeGreaterThan(wild.score);
    expect(calm.components.move).toBeGreaterThan(wild.components.move);
  });

  it('caps the move component at the configured ATR multiple', () => {
    const r = scoreStock({ ...base, price: 120, dayHigh: 120.5 });
    expect(r.components.move).toBe(1);
  });

  it('scores volume zero at or below normal and one at the full-score ratio', () => {
    expect(scoreStock({ ...base, volume: 800_000 }).components.volume).toBe(0);
    expect(scoreStock({ ...base, volume: 3_000_000 }).components.volume).toBe(1);
    expect(scoreStock({ ...base, volume: 2_000_000 }).components.volume).toBeCloseTo(0.5, 5);
  });

  it('volume follows the direction of the move', () => {
    expect(scoreStock({ ...base, price: 98, dayLow: 97.5, dayHigh: 100.1 }).components.volume).toBeLessThan(0);
  });

  it('treats short covering (price up, OI down) as weaker than a long build-up', () => {
    const cover = scoreStock({ ...base, oiChangePct: -4 });
    const build = scoreStock({ ...base, oiChangePct: 4 });
    expect(cover.oi).toBe('short covering');
    expect(cover.components.oi).toBeGreaterThan(0);
    expect(cover.components.oi).toBeLessThan(build.components.oi);
    expect(cover.components.oi).toBeCloseTo(build.components.oi * BOARD_CONFIG.oi.coverUnwindFactor, 5);
  });

  it('treats long unwinding (price down, OI down) as weakly bearish', () => {
    const r = scoreStock({ ...base, price: 98, oiChangePct: -4, dayLow: 97.5, dayHigh: 100.1 });
    expect(r.oi).toBe('long unwinding');
    expect(r.components.oi).toBeLessThan(0);
    expect(r.components.oi).toBeGreaterThan(-BOARD_CONFIG.oi.coverUnwindFactor - 1e-9);
  });

  it('gives a sector bonus only when the sector moves the same way', () => {
    expect(scoreStock({ ...base, sectorChangePct: 1 }).components.sector).toBe(1);
    expect(scoreStock({ ...base, sectorChangePct: -1 }).components.sector).toBe(0);
    expect(scoreStock({ ...base, sectorChangePct: null }).components.sector).toBe(0);
  });

  it('handles missing volume and OI by scoring those components zero', () => {
    const r = scoreStock({ ...base, volume: null, expectedVolume: null, oiChangePct: null });
    expect(r.components.volume).toBe(0);
    expect(r.components.oi).toBe(0);
    expect(r.oi).toBe('n/a');
    expect(r.volumeRatio).toBeNull();
    expect(r.direction).toBe('bull');
  });

  it('zeroes a stock that keeps crossing its own VWAP', () => {
    const r = scoreStock({ ...base, vwapCrossings: BOARD_CONFIG.chop.maxVwapCrossings });
    expect(r.score).toBe(0);
    expect(r.direction).toBeNull();
    expect(r.filtered).toMatch(/VWAP/);
  });

  it('zeroes a stock that keeps crossing its open price', () => {
    expect(scoreStock({ ...base, openCrossings: BOARD_CONFIG.chop.maxOpenCrossings }).filtered).toMatch(/open/);
  });

  it('zeroes a stock whose range is small against its ATR once the session is old enough', () => {
    const quiet = scoreStock({ ...base, dayHigh: 100.4, dayLow: 99.9 });
    expect(quiet.score).toBe(0);
    expect(quiet.filtered).toMatch(/range/);
  });

  it('does not judge choppiness in the first minutes of the session', () => {
    const early = scoreStock({ ...base, minutesElapsed: 10, dayHigh: 100.4, dayLow: 99.9, vwapCrossings: 9, openCrossings: 9 });
    expect(early.filtered).toBeNull();
    expect(early.score).toBeGreaterThan(0);
  });

  it('does not rank a stock that has barely moved, even with strong OI and volume', () => {
    const r = scoreStock({ ...base, price: 100.1, dayHigh: 101.5, dayLow: 99.5 }); // +0.1% on a 2% ATR
    expect(r.score).toBe(0);
    expect(r.direction).toBeNull();
    expect(r.filtered).toMatch(/ATR/);
    expect(scoreStock({ ...base, price: 100.6, dayHigh: 101.5, dayLow: 99.5 }).direction).toBe('bull'); // 0.3 ATR is enough
  });

  it('returns zero for a stock with no usable ATR or previous close', () => {
    expect(scoreStock({ ...base, atrPct: 0 }).score).toBe(0);
    expect(scoreStock({ ...base, prevClose: 0 }).score).toBe(0);
  });

  it('keeps the score within -100 and +100', () => {
    const r = scoreStock({ ...base, price: 500, volume: 1e12, oiChangePct: 500, sectorChangePct: 50, dayHigh: 500 });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThan(95);
  });
});

describe('atrPercent', () => {
  const candles = (n: number, range: number) => Array.from({ length: n }, (_, i) => ({ date: `d${i}`, open: 100, high: 100 + range / 2, low: 100 - range / 2, close: 100, volume: 1000 }));
  it('is the average true range as a percent of the last close', () => {
    expect(atrPercent(candles(20, 4), 14)).toBeCloseTo(4, 5);
  });
  it('uses the gap from the previous close in the true range', () => {
    const list = candles(20, 2);
    list[19] = { ...list[19], open: 110, high: 111, low: 109, close: 110 };
    expect(atrPercent(list, 14)!).toBeGreaterThan(atrPercent(candles(20, 2), 14)!);
  });
  it('returns null when there is too little history', () => {
    expect(atrPercent(candles(10, 4), 14)).toBeNull();
  });
});

describe('avgVolume', () => {
  it('averages the last N sessions, excluding a partial final one if asked', () => {
    const c = Array.from({ length: 25 }, (_, i) => ({ date: `d${i}`, open: 1, high: 1, low: 1, close: 1, volume: i < 24 ? 100 : 9999 }));
    expect(avgVolume(c, 20, true)).toBe(100);
    expect(avgVolume(c, 20, false)).toBeGreaterThan(100);
    expect(avgVolume(c.slice(0, 3), 20, true)).toBeNull();
  });
});

describe('expectedVolume', () => {
  const profile = BOARD_CONFIG.volumeProfile;
  it('pro-rates the daily average along the volume profile', () => {
    expect(expectedVolume({ avgDailyVolume: 1_000_000, minutesElapsed: 0, profile, history: [] })).toBe(0);
    expect(expectedVolume({ avgDailyVolume: 1_000_000, minutesElapsed: 375, profile, history: [] })).toBe(1_000_000);
    expect(expectedVolume({ avgDailyVolume: 1_000_000, minutesElapsed: 15, profile, history: [] })).toBeCloseTo(120_000, 5);
    expect(expectedVolume({ avgDailyVolume: 1_000_000, minutesElapsed: 22.5, profile, history: [] })).toBeCloseTo(160_000, 5); // interpolated
  });
  it('prefers recorded same-time volumes once enough sessions exist', () => {
    const history = [400_000, 500_000, 600_000, 500_000, 500_000];
    expect(expectedVolume({ avgDailyVolume: 1_000_000, minutesElapsed: 60, profile, history, minSessions: 5 })).toBe(500_000);
  });
  it('ignores too-short history', () => {
    expect(expectedVolume({ avgDailyVolume: 1_000_000, minutesElapsed: 60, profile, history: [1, 2], minSessions: 5 })).toBeCloseTo(310_000, 5);
  });
  it('returns null without a baseline', () => {
    expect(expectedVolume({ avgDailyVolume: null, minutesElapsed: 60, profile, history: [] })).toBeNull();
  });
});

describe('countCrossings', () => {
  it('counts sign changes of price minus the reference line', () => {
    expect(countCrossings([101, 99, 101, 99, 101], [100, 100, 100, 100, 100])).toBe(4);
  });
  it('ignores points on the line and missing references', () => {
    expect(countCrossings([101, 100, 101, 99], [100, 100, 100, 100])).toBe(1);
    expect(countCrossings([101, 99], [null, null])).toBe(0);
  });
});
