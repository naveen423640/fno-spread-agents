// The index-direction filter: a stock's up-cross only becomes a long if the index agrees at that same candle, and a down-cross only a short.
// The index side at a candle uses that candle and earlier ones only, so the filter cannot look ahead.
import { EMPTY_PRIOR, foldDay, vwapSeries, type C5, type PriorTotals } from '../core';

export type IndexSide = 1 | -1 | 0 | null; // +1 above, -1 below, 0 exactly on, null when it cannot be told (no volume yet, no previous close)
export type IndexMode = 'vwap-side' | 'day-change';

const sign = (v: number): 1 | -1 | 0 => (v > 0 ? 1 : v < 0 ? -1 : 0);

// For each day and candle start time: where the index is.
//   vwap-side:  index close against the index's own monthly anchored VWAP (anchored at the month's first candle, like the stocks')
//   day-change: index close against the previous session's close
// `days` holds every session available, oldest to newest, so day-change can look across a month boundary.
export function indexSidesByDay(days: Map<string, C5[]>, mode: IndexMode): Map<string, Map<number, IndexSide>> {
  const out = new Map<string, Map<number, IndexSide>>();
  const sessions = [...days.keys()].sort();
  let prior: PriorTotals = EMPTY_PRIOR;
  let month = '';
  let previousClose: number | null = null;
  for (const day of sessions) {
    const candles = [...days.get(day)!].sort((a, b) => a.t - b.t);
    if (day.slice(0, 7) !== month) { month = day.slice(0, 7); prior = EMPTY_PRIOR; }
    const sides = new Map<number, IndexSide>();
    if (mode === 'vwap-side') {
      const vwap = vwapSeries(prior, candles);
      candles.forEach((c, i) => sides.set(c.t, vwap[i] === null ? null : sign(c.c - vwap[i]!)));
      prior = foldDay(prior, candles);
    } else {
      candles.forEach((c) => sides.set(c.t, previousClose === null ? null : sign(c.c - previousClose!)));
    }
    previousClose = candles[candles.length - 1]?.c ?? previousClose;
    out.set(day, sides);
  }
  return out;
}

// Does the index allow this direction? A missing or neutral reading blocks the trade: with no information, the filter says no.
export function indexAllows(direction: 'up' | 'down', side: IndexSide | undefined): boolean {
  if (side === null || side === undefined || side === 0) return false;
  return direction === 'up' ? side === 1 : side === -1;
}
