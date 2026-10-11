import { describe, expect, it } from 'vitest';

import { ABLATION_VARIANTS, dailyBaselines, exitPrice, replayBoard, runAblation, runBacktest, type IndexHistory, type StockHistory } from '@/lib/board/backtest';
import { BOARD_CONFIG } from '@/lib/board/config';
import type { C5 } from '@/lib/board/zones';

function rng(seed: number) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function weekdays(count: number) {
  const out: string[] = [];
  const d = new Date('2026-07-01T00:00:00Z');
  while (out.length < count) { if (d.getUTCDay() % 6 !== 0) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// 30 stocks over `dayCount` sessions. Stock 0 climbs 3% by 10:30 then another 2% (a clean long build-up with 4x volume); stock 1 mirrors it
// downward. The others drift by noise only. Prices are reset each session so ATR stays realistic. Returns the data plus the day list.
function build(dayCount: number, seed = 1, planted = true) {
  const random = rng(seed);
  const days = weekdays(dayCount);
  const stocks: StockHistory[] = [];
  for (let i = 0; i < 30; i += 1) {
    const base = 100 + i;
    const m5 = new Map<string, C5[]>();
    const daily: StockHistory['daily'] = [];
    const oi = new Map<string, number>();
    days.forEach((day, di) => {
      const open = Date.parse(`${day}T09:15:00+05:30`) / 1000;
      const sign = !planted ? 0 : i === 0 ? 1 : i === 1 ? -1 : 0;
      const candles: C5[] = [];
      let previous = base;
      let walk = 0;
      for (let k = 0; k < 75; k += 1) {
        const drift = sign === 0 ? 0 : k < 15 ? 0.03 * ((k + 1) / 15) : k < 30 ? 0.03 + 0.02 * ((k - 14) / 15) : k < 60 ? 0.05 : 0.05 * ((74 - k) / 14);
        walk += sign === 0 ? (random() - 0.5) * (planted ? 0.0008 : 0.01) : 0; // a random walk; the pure-noise market is livelier so some stocks do rank
        const noise = walk;
        const close = base * (1 + sign * drift + noise);
        const wick = base * 0.0006;
        candles.push({ t: open + k * 300, o: previous, h: Math.max(previous, close) + wick, l: Math.min(previous, close) - wick, c: close, v: sign !== 0 && k < 15 ? 53_000 : 13_333 });
        previous = close;
      }
      // Every stock has the same ordinary 1.5% daily range, so the planted moves are large in ATR terms.
      daily.push({ date: day, open: base, high: base * 1.0075, low: base * 0.9925, close: base, volume: 1_000_000 });
      if (di >= 20) m5.set(day, candles);
      oi.set(day, sign !== 0 ? 1_000_000 * 1.05 ** di : 1_000_000);
    });
    stocks.push({ symbol: `S${i}`, ticker: `S${i}`, sector: 'Banks', sectorIndex: null, m5, daily, oi });
  }
  return { stocks, days, indices: new Map() as IndexHistory };
}

describe('exitPrice', () => {
  const c = (t: number, close: number): C5 => ({ t, o: close, h: close, l: close, c: close, v: 1 });
  it('uses the close of the last candle that ended by the target', () => {
    expect(exitPrice([c(0, 1), c(300, 2), c(600, 3)], 900)).toBe(3);
    expect(exitPrice([c(0, 1), c(300, 2), c(600, 3)], 600)).toBe(2);
  });
  it('gives nothing when the session ended well before the target', () => {
    expect(exitPrice([c(0, 1), c(300, 2)], 3000)).toBeNull();
  });
});

describe('replayBoard', () => {
  it('ranks the planted leader first on the bullish side and the planted laggard first on the bearish side', () => {
    const { stocks, days, indices } = build(45);
    const day = days[30];
    const r = replayBoard(stocks, indices, day, '10:30', dailyBaselines(stocks, day, 20))!;
    expect(r.board.bullish[0].symbol).toBe('S0');
    expect(r.board.bearish[0].symbol).toBe('S1');
    expect(r.board.bullish[0].oi).toBe('long buildup');
  });

  it('cannot see anything after the checkpoint: changing later candles, later daily candles or later OI changes nothing', () => {
    const { stocks, days, indices } = build(45);
    const day = days[30];
    const before = replayBoard(stocks, indices, day, '10:00', dailyBaselines(stocks, day, 20))!;
    const tampered = structuredClone(stocks);
    const endTs = before.endTs;
    for (const s of tampered) {
      for (const [d, candles] of s.m5) for (const candle of candles) if (d > day || (d === day && candle.t + 300 > endTs)) { candle.o = candle.h = candle.l = candle.c = 9999; candle.v = 9e9; }
      for (const candle of s.daily) if (candle.date >= day) { candle.high = 5000; candle.close = 4000; candle.volume = 9e9; }
      for (const d of s.oi.keys()) if (d >= day) s.oi.set(d, 123);
    }
    const after = replayBoard(tampered, indices, day, '10:00', dailyBaselines(tampered, day, 20))!;
    expect(JSON.stringify(after.board)).toBe(JSON.stringify(before.board));
  });

  it('ignores a one-day OI jump of more than 40% as a contract roll', () => {
    const { stocks, days, indices } = build(45);
    const day = days[30];
    const rolled = structuredClone(stocks);
    rolled[0].oi.set(days[29], rolled[0].oi.get(days[28])! * 2); // OI doubles overnight
    const r = replayBoard(rolled, indices, day, '10:30', dailyBaselines(rolled, day, 20))!;
    const entry = r.board.bullish.find((e) => e.symbol === 'S0');
    expect(entry?.oi ?? 'n/a').toBe('n/a');
    expect(entry?.oiChangePct ?? null).toBeNull();
  });

  it('skips a day without enough prior daily history', () => {
    const { stocks, days } = build(45);
    expect(dailyBaselines(stocks, days[5], 20).size).toBe(0);
  });
});

describe('runBacktest', () => {
  it('measures the planted continuation as a positive directional return on both sides, with a hit rate above one half', () => {
    const { stocks, indices } = build(45);
    const report = runBacktest(stocks, indices);
    const row = (group: string, checkpoint: string, horizon: string) => report.rows.find((r) => r.group === group && r.checkpoint === checkpoint && r.horizon === horizon)!;
    const bull = row('Score top 5 bullish', '10:30', '60m');
    const bear = row('Score top 5 bearish', '10:30', '60m');
    expect(bull.meanPct).toBeGreaterThan(0.2); // S0 adds about +1.6% over the hour, shared among the picks
    expect(bear.meanPct).toBeGreaterThan(0.2); // directional: S1 falling counts as a gain for a bearish pick
    expect(bull.hitRate).toBeGreaterThan(0.5);
    expect(bear.hitRate).toBeGreaterThan(0.5);
    expect(bull.netMeanPct).toBeCloseTo(bull.meanPct - 0.1, 8);
    expect(report.sessions).toBe(25);
    expect(report.firstDay).toBe(report.rows.length ? report.firstDay : null);
  });

  it('refuses to call a verdict on fewer than 30 sessions and says so', () => {
    const { stocks, indices } = build(45);
    const report = runBacktest(stocks, indices);
    expect(report.rows.every((r) => r.verdict === 'not enough sessions to conclude')).toBe(true);
    expect(report.warnings.join(' ')).toMatch(/Only 25 sessions/);
  });

  it('does give a verdict once there are 30 or more sessions', () => {
    const { stocks, indices } = build(55);
    const report = runBacktest(stocks, indices);
    expect(report.sessions).toBe(35);
    expect(report.rows.some((r) => r.verdict !== 'not enough sessions to conclude')).toBe(true);
  });

  it('finds no edge in pure noise: score and baseline both average about zero', () => {
    const { stocks, indices } = build(70, 7, false);
    const report = runBacktest(stocks, indices);
    const all = report.rows.filter((r) => r.checkpoint === 'all' && r.horizon === 'close');
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) expect(Math.abs(r.meanPct)).toBeLessThan(0.15);
    // Many rows are tested at once, so the odd one can look significant by luck; most must not.
    const flagged = report.rows.filter((r) => r.verdict === 'score beats the baseline' || r.verdict === 'baseline beats the score').length;
    expect(flagged / report.rows.length).toBeLessThan(0.2);
  });

  it('returns an empty report when there is no usable history', () => {
    const report = runBacktest([], new Map());
    expect(report).toMatchObject({ sessions: 0, rows: [], firstDay: null });
    expect(report.warnings.join(' ')).toMatch(/Only 0 sessions/);
  });

  it('includes the close horizon and a per-checkpoint breakdown', () => {
    const { stocks, indices } = build(45);
    const report = runBacktest(stocks, indices);
    expect(new Set(report.rows.map((r) => r.horizon))).toEqual(new Set(['30m', '60m', 'close']));
    expect(new Set(report.rows.map((r) => r.checkpoint))).toEqual(new Set(['all', '09:30', '10:00', '10:30']));
  });
});

describe('ablation', () => {
  it('a sector-only score ranks nothing when no stock has a sector index, while move-only still finds the planted leader', () => {
    const { stocks, days, indices } = build(45);
    const day = days[30];
    const baselines = dailyBaselines(stocks, day, 20);
    const cfgOf = (name: string) => ({ ...BOARD_CONFIG, weights: ABLATION_VARIANTS.find((v) => v.name === name)!.weights }) as unknown as typeof BOARD_CONFIG;
    expect(replayBoard(stocks, indices, day, '10:30', baselines, cfgOf('Sector only'))!.board.bullish).toEqual([]);
    expect(replayBoard(stocks, indices, day, '10:30', baselines, cfgOf('Move only'))!.board.bullish[0].symbol).toBe('S0');
  });

  it('gives one result per variant, each measured on the same sessions, and the full score matches the main report', () => {
    const { stocks, indices } = build(45);
    const results = runAblation(stocks, indices);
    expect(results.map((r) => r.name)).toEqual(['Move only', 'Volume only', 'OI only', 'Sector only', 'Full score']);
    const full = results.find((r) => r.name === 'Full score')!;
    const main = runBacktest(stocks, indices).rows.filter((r) => r.checkpoint === 'all');
    expect(full.rows.map((r) => r.meanPct)).toEqual(main.map((r) => r.meanPct));
    expect(full.sessions).toBe(25);
  });
});
