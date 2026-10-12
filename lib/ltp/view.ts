// Pure helpers for the LTP Levels tab: which table cells to highlight, the health badge colour and the COA 2.0 window label.
import { LTP_CONFIG } from './config';
import type { ChainView } from './state';
import { minutesOf } from './time';

export type CellMark = 'max' | 'second_weak';

// Keys are `${strike}|${side}|${metric}`. Puts are searched at and below the imaginary line and calls at and above it, exactly like the engine.
// The highest value of each column gets 'max'; the second-highest gets 'second_weak' only when it is MORE than `weakPct` percent of the highest
// (the yellow box). Missing values are skipped, never read as zero.
export function highlightCells(chain: ChainView[], line: { low: number; high: number }, weakPct: number = LTP_CONFIG.weakThresholdPct): Record<string, CellMark> {
  const marks: Record<string, CellMark> = {};
  for (const side of ['PE', 'CE'] as const) {
    for (const metric of ['volume', 'oi'] as const) {
      const ranked = chain
        .filter((r) => (side === 'PE' ? r.strike <= line.low : r.strike >= line.high))
        .flatMap((r) => { const v = (side === 'PE' ? r.pe : r.ce)?.[metric]; return v === null || v === undefined ? [] : [{ strike: r.strike, v }]; })
        .sort((a, b) => b.v - a.v || (side === 'PE' ? b.strike - a.strike : a.strike - b.strike));
      const [top, second] = ranked;
      if (!top) continue;
      marks[`${top.strike}|${side}|${metric}`] = 'max';
      if (second && top.v > 0 && (second.v / top.v) * 100 > weakPct) marks[`${second.strike}|${side}|${metric}`] = 'second_weak';
    }
  }
  return marks;
}

export function healthBadge(ageSeconds: number | null): 'green' | 'amber' | 'red' {
  if (ageSeconds === null) return 'red';
  return ageSeconds < 120 ? 'green' : ageSeconds < 300 ? 'amber' : 'red';
}

export function windowLabel(hhmm: string): { state: 'before' | 'valid' | 'after'; text: string } {
  const { windowStart, windowEnd } = LTP_CONFIG.coa2;
  const m = minutesOf(hhmm);
  if (m < minutesOf(windowStart)) return { state: 'before', text: `COA 2.0 starts at ${windowStart}` };
  if (m > minutesOf(windowEnd)) return { state: 'after', text: `COA 2.0 window closed at ${windowEnd}` };
  return { state: 'valid', text: `COA 2.0 valid (${windowStart}–${windowEnd})` };
}
