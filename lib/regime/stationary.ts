import type { Matrix } from './types';

// Least squares for [P^T - I; 1 1 1] * pi = [0 0 0 1], solved through the 3x3 normal equations.
// Returns null when the input is not a probability matrix (a row does not sum to 1, e.g. an empty row)
// or when the solution is not unique, so a meaningless vector is never shown.
export function stationaryDistribution(matrix: Matrix): number[] | null {
  if (matrix.some((row) => Math.abs(row.reduce((sum, value) => sum + value, 0) - 1) > 1e-9)) return null;
  const rows: number[][] = [0, 1, 2].map((i) => [0, 1, 2].map((j) => matrix[j][i] - (i === j ? 1 : 0)));
  rows.push([1, 1, 1]);
  const target = [0, 0, 0, 1];
  const a = [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows.reduce((sum, row) => sum + row[i] * row[j], 0)));
  const b = [0, 1, 2].map((i) => rows.reduce((sum, row, k) => sum + row[i] * target[k], 0));

  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 3; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = col + 1; r < 3; r += 1) {
      const factor = a[r][col] / a[col][col];
      for (let c = col; c < 3; c += 1) a[r][c] -= factor * a[col][c];
      b[r] -= factor * b[col];
    }
  }
  const pi = [0, 0, 0];
  for (let r = 2; r >= 0; r -= 1) {
    let sum = b[r];
    for (let c = r + 1; c < 3; c += 1) sum -= a[r][c] * pi[c];
    pi[r] = sum / a[r][r];
  }
  return pi;
}
