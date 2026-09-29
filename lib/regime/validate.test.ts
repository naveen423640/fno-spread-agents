import { describe, expect, it } from 'vitest';

import { RegimeInputError } from './types';
import { findGaps, flagPossibleCorporateActions, truncateAsOf, validateCandles } from './validate';

const c = (date: string, close: number) => ({ date, close });

describe('validateCandles', () => {
  it('sorts unsorted input ascending by date', () => {
    const out = validateCandles([c('2026-01-03', 3), c('2026-01-01', 1), c('2026-01-02', 2)]);
    expect(out.map((x) => x.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  it('does not mutate its input', () => {
    const input = [c('2026-01-02', 2), c('2026-01-01', 1)];
    validateCandles(input);
    expect(input[0].date).toBe('2026-01-02');
  });

  it('rejects duplicate dates', () => {
    expect(() => validateCandles([c('2026-01-01', 1), c('2026-01-01', 2)])).toThrow(RegimeInputError);
  });

  it('rejects non-positive, NaN and infinite closes', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateCandles([c('2026-01-01', bad)])).toThrow(RegimeInputError);
    }
  });

  it('rejects malformed dates', () => {
    expect(() => validateCandles([c('01/01/2026', 1)])).toThrow(RegimeInputError);
  });
});

describe('truncateAsOf', () => {
  it('keeps only closes on or before the as-of date', () => {
    const out = truncateAsOf([c('2026-01-01', 1), c('2026-01-02', 2), c('2026-01-03', 3)], '2026-01-02');
    expect(out.map((x) => x.date)).toEqual(['2026-01-01', '2026-01-02']);
  });
});

describe('findGaps', () => {
  it('reports gaps longer than the limit and ignores normal weekends', () => {
    const gaps = findGaps([c('2026-01-02', 1), c('2026-01-05', 1), c('2026-01-20', 1)], 7);
    expect(gaps).toEqual([{ from: '2026-01-05', to: '2026-01-20', days: 15 }]);
  });
});

describe('flagPossibleCorporateActions', () => {
  it('flags a >0.25 log move in either direction and lists the date', () => {
    const flags = flagPossibleCorporateActions([c('2026-01-01', 100), c('2026-01-02', 20), c('2026-01-03', 21), c('2026-01-04', 90)]);
    expect(flags.map((f) => f.date)).toEqual(['2026-01-02', '2026-01-04']);
    expect(flags[0].logReturn).toBeCloseTo(Math.log(0.2), 10);
  });

  it('does not flag a move of exactly the threshold', () => {
    const close = 100 * Math.exp(0.25);
    expect(flagPossibleCorporateActions([c('2026-01-01', 100), c('2026-01-02', close)])).toEqual([]);
  });
});
