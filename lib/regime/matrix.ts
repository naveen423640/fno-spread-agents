import { STATES, type Label, type Matrix } from './types';

const index = (state: NonNullable<Label>) => STATES.indexOf(state);

export function countTransitions(labels: Label[]): number[][] {
  const counts = STATES.map(() => STATES.map(() => 0));
  for (let t = 1; t < labels.length; t += 1) {
    const from = labels[t - 1];
    const to = labels[t];
    if (from && to) counts[index(from)][index(to)] += 1;
  }
  return counts;
}

export function normalizeRows(counts: number[][]): { matrix: Matrix; emptyRows: number[] } {
  const emptyRows: number[] = [];
  const matrix = counts.map((row, i) => {
    const total = row.reduce((sum, value) => sum + value, 0);
    if (total === 0) {
      emptyRows.push(i);
      return row.map(() => 0);
    }
    return row.map((value) => value / total);
  });
  return { matrix, emptyRows };
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
}

export function matrixPower(matrix: Matrix, n: number): Matrix {
  let result: Matrix = matrix.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
  for (let step = 0; step < n; step += 1) result = multiply(result, matrix);
  return result;
}

export function timeShare(labels: Label[]): number[] {
  const counts = [0, 0, 0];
  for (const label of labels) if (label) counts[index(label)] += 1;
  const total = counts.reduce((sum, value) => sum + value, 0);
  return total === 0 ? counts : counts.map((value) => value / total);
}
