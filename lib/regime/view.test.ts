import { describe, expect, it } from 'vitest';

import { DISPLAY_ORDER, formatPercent, regimeBands, toDisplayMatrix } from './view';

describe('toDisplayMatrix', () => {
  it('reorders [Bear,Sideways,Bull] rows and columns to Bull,Sideways,Bear', () => {
    const P = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    expect(toDisplayMatrix(P)).toEqual([[9, 8, 7], [6, 5, 4], [3, 2, 1]]);
    expect(DISPLAY_ORDER).toEqual(['Bull', 'Sideways', 'Bear']);
  });

  it('does not mutate its input', () => {
    const P = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    toDisplayMatrix(P);
    expect(P).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  });
});

describe('regimeBands', () => {
  it('groups contiguous runs and skips undefined labels', () => {
    const dates = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
    expect(regimeBands(dates, [null, 'Bull', 'Bull', 'Sideways', 'Bull', null])).toEqual([
      { start: 'd2', end: 'd3', label: 'Bull' },
      { start: 'd4', end: 'd4', label: 'Sideways' },
      { start: 'd5', end: 'd5', label: 'Bull' },
    ]);
  });

  it('does not join two runs of the same label separated by an undefined label', () => {
    const dates = ['d1', 'd2', 'd3'];
    expect(regimeBands(dates, ['Bull', null, 'Bull'])).toEqual([
      { start: 'd1', end: 'd1', label: 'Bull' },
      { start: 'd3', end: 'd3', label: 'Bull' },
    ]);
  });

  it('returns nothing when every label is undefined', () => {
    expect(regimeBands(['d1', 'd2'], [null, null])).toEqual([]);
  });
});

describe('formatPercent', () => {
  it('formats with sign and shows a dash for null', () => {
    expect(formatPercent(0.1151, 2, true)).toBe('+11.51%');
    expect(formatPercent(-0.05, 1, true)).toBe('−5.0%');
    expect(formatPercent(0.2, 0)).toBe('20%');
    expect(formatPercent(null)).toBe('—');
  });

  it('shows a dash for NaN and Infinity, never the word', () => {
    expect(formatPercent(Number.NaN)).toBe('—');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('shows a plain zero without a sign character for negative zero', () => {
    expect(formatPercent(-0, 1, true)).toBe('+0.0%');
  });
});
