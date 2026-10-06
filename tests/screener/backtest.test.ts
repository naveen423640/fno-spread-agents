import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../../lib/screener/config';
import { addIndicators } from '../../lib/screener/indicators';
import { erf, npRound, pyRound } from '../../lib/screener/numeric';
import { bs, halfStats, runBacktest, simulate, stats } from '../../lib/screener/backtest';
import type { Candle, IndRow } from '../../lib/screener/types';
import { candlesOf, closeTo, loadGolden } from '../support/screener-golden';

const P = DEFAULT_PARAMS;
const golden = loadGolden();
const bench = candlesOf(golden, '^NSEI');
const symbols = Object.keys(golden.data).filter((s) => s !== '^NSEI');
const data: Record<string, Candle[]> = Object.fromEntries(symbols.map((s) => [s, candlesOf(golden, s)]));
const indicators: Record<string, IndRow[]> = Object.fromEntries(symbols.map((s) => [s, addIndicators(data[s], bench)]));

describe('numeric helpers', () => {
  it('erf agrees with the known values of math.erf to 1e-12', () => {
    const known: [number, number][] = [[0, 0], [0.1, 0.1124629160182849], [0.7, 0.6778011938374185], [1.3, 0.9340079449406524], [2.0, 0.9953222650189527], [2.9, 0.9999589021219005], [-1.3, -0.9340079449406524]];
    for (const [x, expected] of known) expect(Math.abs(erf(x) - expected), `erf(${x})`).toBeLessThan(1e-12);
    expect(erf(8)).toBe(1);
    expect(erf(-8)).toBe(-1);
  });

  it('npRound matches numpy round (scale, half to even, divide) on every golden case, including the near-ties where it differs from Python', () => {
    expect(golden.np_round.length).toBeGreaterThan(500);
    for (const c of golden.np_round) expect(npRound(c.x, c.d), `npRound(${c.x}, ${c.d})`).toBe(c.out);
    expect([npRound(1234.55, 1), npRound(99.45, 1), npRound(1000.15, 1), npRound(250.05, 1)]).toEqual([1234.6, 99.4, 1000.2, 250]);
    expect(npRound(Number.NaN, 1)).toBeNaN();
  });

  it('pyRound rounds half to even like Python round()', () => {
    expect([0.5, 1.5, 2.5, 3.5, -2.5].map((x) => pyRound(x))).toEqual([0, 2, 2, 4, -2]);
    expect(pyRound(12.25, 1)).toBe(12.2);
    expect(pyRound(12.75, 1)).toBe(12.8);
    expect(pyRound(2.675, 2)).toBe(2.67);
    expect(pyRound(1.005, 2)).toBe(1);
    expect(pyRound(Number.NaN, 2)).toBeNaN();
  });
});

describe('bs matches the reference', () => {
  it.each(golden.bs.map((c, i) => [i, c] as const))('golden case %i', (_i, c) => {
    expect(closeTo(bs(c.S, c.K, c.T, c.sig, c.call), c.out), `bs(${c.S},${c.K},${c.T},${c.sig},${c.call})`).toBe(true);
  });

  it('is intrinsic value at expiry and put-call parity holds', () => {
    expect(bs(80, 90, 0, 0.3, false)).toBe(10);
    expect(bs(80, 70, 0, 0.3, false)).toBe(0);
    const call = bs(100, 105, 0.25, 0.3, true);
    const put = bs(100, 105, 0.25, 0.3, false);
    expect(call - put).toBeCloseTo(100 - 105 * Math.exp(-0.065 * 0.25), 8);
  });
});

describe('simulate matches the reference', () => {
  it('covers a useful number of cases including skipped entries', () => {
    expect(golden.simulate.length).toBeGreaterThan(100);
    expect(golden.simulate.some((c) => c.result === null)).toBe(true);
    expect(new Set(golden.simulate.flatMap((c) => (c.result ? [c.result.why] : []))).size).toBeGreaterThanOrEqual(2);
  });

  it('every golden case: the same exit, day count, R and risk', () => {
    for (const c of golden.simulate) {
      const actual = simulate(indicators[c.sym], c.i, c.side, P);
      if (c.result === null) { expect(actual, `${c.variant} ${c.sym}[${c.i}]`).toBeNull(); continue; }
      expect(actual, `${c.variant} ${c.sym}[${c.i}]`).not.toBeNull();
      expect(actual?.entry).toBe(c.result.entry);
      expect(actual?.days).toBe(c.result.days);
      expect(actual?.why).toBe(c.result.why);
      expect(closeTo(actual?.R ?? Number.NaN, c.result.R), 'R').toBe(true);
      expect(closeTo(actual?.riskPctSpot ?? Number.NaN, c.result.risk_pct_spot), 'risk').toBe(true);
    }
  });

  it('returns null when there is not enough history after the signal', () => {
    const rows = indicators[symbols[0]];
    expect(simulate(rows, rows.length - 5, 1, P)).toBeNull();
  });
});

describe('runBacktest and stats match the reference', () => {
  const results = runBacktest(data, bench, P);
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));

  it('returns the six variants in reference order', () => {
    expect(results.map((r) => r.name)).toEqual(Object.keys(golden.backtest));
  });

  for (const [name, expected] of Object.entries(golden.backtest)) {
    it(`${name}: same trades in the same order`, () => {
      const trades = byName[name].trades;
      expect(trades).toHaveLength(expected.trades.length);
      expected.trades.forEach((t, k) => {
        expect(trades[k]).toMatchObject({ sym: t.sym, entry: t.entry, days: t.days, why: t.why });
        expect(closeTo(trades[k].R, t.R), `${name}[${k}] R`).toBe(true);
        expect(closeTo(trades[k].riskPctSpot, t.risk_pct_spot), `${name}[${k}] risk`).toBe(true);
      });
    });

    it(`${name}: stats and half-period stats`, () => {
      const compare = (actual: ReturnType<typeof stats>, want: Record<string, number | null>) => {
        expect(actual.n).toBe(want.n);
        if (want.n === 0) return;
        expect(actual.winRate).toBe(want.win_rate);
        expect(actual.avgWinR).toBe(want.avg_win_R);
        expect(actual.avgLossR).toBe(want.avg_loss_R);
        expect(actual.expectancyR).toBe(want.expectancy_R);
        expect(actual.profitFactor ?? null).toBe(want.profit_factor);
      };
      compare(byName[name].stats, expected.stats);
      if (expected.first_half) {
        compare(byName[name].firstHalf as ReturnType<typeof stats>, expected.first_half);
        compare(byName[name].secondHalf as ReturnType<typeof stats>, expected.second_half as Record<string, number | null>);
      }
    });
  }

  it('reports progress once per variant', () => {
    const seen: [number, number][] = [];
    runBacktest(data, bench, P, (done, total) => seen.push([done, total]));
    expect(seen).toEqual(Array.from({ length: 6 }, (_, i) => [i + 1, 6]));
  });
});

describe('stats on hand-made trades', () => {
  const trade = (R: number, entry = '2025-01-01') => ({ sym: 'X', variant: 'v', entry, days: 5, why: 'TP' as const, R, riskPctSpot: 3 });

  it('empty input gives n = 0 only', () => {
    expect(stats([])).toEqual({ n: 0 });
  });

  it('win rate, average win and loss in R, expectancy and profit factor', () => {
    const s = stats([trade(1), trade(0.5), trade(-0.5), trade(-1), trade(0)]);
    expect(s).toEqual({ n: 5, winRate: 40, avgWinR: 0.75, avgLossR: -0.5, expectancyR: 0, profitFactor: 1 });
  });

  it('profit factor is null when there are no losing trades', () => {
    expect(stats([trade(1), trade(2)]).profitFactor).toBeNull();
  });

  it('halfStats splits at the median entry date: first half before it, second half from it', () => {
    const trades = [trade(1, '2025-01-01'), trade(1, '2025-02-01'), trade(-1, '2025-03-01'), trade(-1, '2025-04-01')];
    const { firstHalf, secondHalf } = halfStats(trades);
    expect(firstHalf.n).toBe(2);
    expect(secondHalf.n).toBe(2);
    expect(firstHalf.expectancyR).toBe(1);
    expect(secondHalf.expectancyR).toBe(-1);
  });
});
