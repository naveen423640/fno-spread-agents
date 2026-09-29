import type { Label, State } from './types';

export const DISPLAY_ORDER = ['Bull', 'Sideways', 'Bear'] as const;

// Maths order is [Bear, Sideways, Bull]; the mockup shows Bull, Sideways, Bear.
export function toDisplayMatrix(matrix: number[][]): number[][] {
  const order = [2, 1, 0];
  return order.map((row) => order.map((col) => matrix[row][col]));
}

export function regimeBands(dates: string[], labels: Label[]) {
  const bands: { start: string; end: string; label: State }[] = [];
  labels.forEach((label, i) => {
    if (!label) return;
    const previous = bands.at(-1);
    if (previous && previous.label === label && previous.end === dates[i - 1]) previous.end = dates[i];
    else bands.push({ start: dates[i], end: dates[i], label });
  });
  return bands;
}

export function formatPercent(value: number | null, digits = 1, signed = false) {
  if (value === null || !Number.isFinite(value)) return '—';
  const text = Math.abs(value * 100).toFixed(digits);
  const sign = value < 0 ? '−' : signed ? '+' : '';
  return `${sign}${text}%`;
}
