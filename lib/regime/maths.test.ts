import { describe, expect, it } from 'vitest';

import fixture from '@/tests/fixtures/regime-fixture.json';

import { decide } from './decision';
import { forecastPath, forecastRow, signalScore } from './forecast';
import { labelSeries } from './labels';
import { countTransitions, matrixPower, normalizeRows, timeShare } from './matrix';
import { stationaryDistribution } from './stationary';
import type { LabelWindow, Method, State } from './types';

const close = (a: number[] | null, b: number[], tol = 1e-9) => {
  expect(a).not.toBeNull();
  a!.forEach((value, i) => expect(Math.abs(value - b[i])).toBeLessThan(tol));
};

describe('maths against the fixture', () => {
  for (const item of fixture.cases) {
    describe(`window ${item.window} / ${item.method}`, () => {
      const { labels } = labelSeries(fixture.closes, item.window as LabelWindow, item.method as Method);
      const counts = countTransitions(labels);
      const { matrix } = normalizeRows(counts);

      it('counts exactly', () => expect(counts).toEqual(item.counts));
      it('matrix within 1e-9', () => item.matrix.forEach((row, i) => close(matrix[i], row)));
      it('stationary within 1e-9', () => close(stationaryDistribution(matrix), item.stationary));
      it('time share within 1e-9', () => close(timeShare(labels), item.timeShare));
      it('forecasts and scores within 1e-9', () => {
        for (const n of [1, 5, 10]) {
          const row = forecastRow(matrix, item.current as State, n);
          close(row, (item.forecast as Record<string, number[]>)[String(n)]);
          expect(Math.abs(signalScore(row!) - (item.score as Record<string, number>)[String(n)])).toBeLessThan(1e-9);
        }
      });
    });
  }
});

describe('matrix edge cases', () => {
  it('leaves an empty row as zeros and reports it', () => {
    const { matrix, emptyRows } = normalizeRows([[0, 0, 0], [1, 1, 0], [0, 0, 2]]);
    expect(matrix[0]).toEqual([0, 0, 0]);
    expect(matrix[1]).toEqual([0.5, 0.5, 0]);
    expect(emptyRows).toEqual([0]);
  });

  it('matrixPower(P, 0) is the identity and P^1 is P', () => {
    const P = [[0.5, 0.5, 0], [0.2, 0.6, 0.2], [0, 0.4, 0.6]];
    expect(matrixPower(P, 0)).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(matrixPower(P, 1)).toEqual(P);
  });

  it('counts only consecutive pairs where both labels are defined', () => {
    expect(countTransitions([null, 'Bull', 'Bull', null, 'Bear', 'Bull'])).toEqual([[0, 0, 1], [0, 0, 0], [0, 0, 1]]);
  });

  it('forecastRow is null when the from-state row is empty; forecastPath starts at the indicator row', () => {
    const P = [[0, 0, 0], [0.5, 0.5, 0], [0, 0.5, 0.5]];
    expect(forecastRow(P, 'Bear', 5)).toBeNull();
    expect(forecastPath(P, 'Sideways', 2).map((s) => s.step)).toEqual([0, 1, 2]);
    expect(forecastPath(P, 'Sideways', 2)[0].probs).toEqual([0, 1, 0]);
  });

  it('stationaryDistribution is unavailable when a row is empty (not a probability matrix)', () => {
    expect(stationaryDistribution([[0, 0, 0], [0, 0, 0], [0, 0, 0]])).toBeNull();
    expect(stationaryDistribution([[0, 0, 0], [0.5, 0.5, 0], [0, 0.5, 0.5]])).toBeNull();
  });

  it('stationaryDistribution is unavailable when it is not unique (identity matrix)', () => {
    expect(stationaryDistribution([[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBeNull();
  });
});

describe('decide', () => {
  it('applies inclusive thresholds at theta', () => {
    expect(decide(0.2, 0.2)).toBe('Long candidate');
    expect(decide(-0.2, 0.2)).toBe('Short candidate');
    expect(decide(0.19, 0.2)).toBe('No trade');
    expect(decide(-0.19, 0.2)).toBe('No trade');
  });

  it('defaults theta to the configured 0.20', () => {
    expect(decide(0.25)).toBe('Long candidate');
    expect(decide(0.1)).toBe('No trade');
  });
});
