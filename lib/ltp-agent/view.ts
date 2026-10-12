// Small pure helpers for the Agent tab.
import type { Position } from './books';

export function heartbeatBadge(ageSeconds: number | null): 'green' | 'amber' | 'red' {
  if (ageSeconds === null) return 'red';
  return ageSeconds < 120 ? 'green' : ageSeconds < 300 ? 'amber' : 'red';
}

// The running net P&L, in close order.
export function equityCurve(trades: { ts: number; net: number }[]): { ts: number; equity: number }[] {
  let equity = 0;
  return [...trades].sort((a, b) => a.ts - b.ts).map((t) => ({ ts: t.ts, equity: (equity += t.net) }));
}

// The gross open profit or loss of a position at its last mark, before charges.
export function mtmOf(p: Position): number {
  return p.legs.reduce((sum, l) => sum + (l.side === 'buy' ? l.lastLtp - l.entryPrice : l.entryPrice - l.lastLtp) * p.qty, 0);
}
