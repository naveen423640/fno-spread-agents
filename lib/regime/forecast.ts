import { REGIME_CONFIG } from './config';
import { matrixPower } from './matrix';
import { STATES, type Matrix, type State } from './types';

export function forecastRow(matrix: Matrix, from: State, n: number): number[] | null {
  const start = STATES.indexOf(from);
  if (matrix[start].every((value) => value === 0)) return null;
  return matrixPower(matrix, n)[start];
}

export function signalScore(row: number[]): number {
  return row[2] - row[0];
}

export function forecastPath(matrix: Matrix, from: State, steps: number = REGIME_CONFIG.forecastPathSteps) {
  const start = STATES.indexOf(from);
  return Array.from({ length: steps + 1 }, (_, step) => ({ step, probs: matrixPower(matrix, step)[start] }));
}
