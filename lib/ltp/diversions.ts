// C7 diversions. A diversion is a profit-booking point on the way from one level to the other; an end of diversion is where a new trade starts.
import type { ExtensionMethod } from './extensions';
import type { Snapshot } from './types';

export type DiversionPoint = { kind: 'diversion' | 'end_of_diversion'; strike: number; price: number | null; method: string; isProxy: true };

// Strikes strictly between support and resistance, plus one. The same strike on both sides gives 0.
export function diversionCount(support: number, resistance: number, step: number): number {
  if (support === resistance || !(step > 0)) return 0;
  return Math.round(Math.abs(resistance - support) / step);
}

// The ordered prices along a path. Bullish (support up to resistance): at each strike above the support, the call-side reversal is the
// diversion and the put-side reversal the end of diversion. Bearish is the mirror, from the resistance down: put-side diversions, call-side ends.
export function diversionPath(s: Snapshot, support: number, resistance: number, direction: 'bullish' | 'bearish', method: ExtensionMethod): DiversionPoint[] {
  const count = diversionCount(support, resistance, s.step);
  const lo = Math.min(support, resistance);
  const hi = Math.max(support, resistance);
  const point = (kind: DiversionPoint['kind'], strike: number, side: 'CE' | 'PE'): DiversionPoint => ({ kind, strike, price: method.reversal(s, strike, side), method: method.id, isProxy: true });
  const out: DiversionPoint[] = [];
  for (let i = 1; i <= count; i += 1) {
    if (direction === 'bullish') {
      const strike = lo + i * s.step;
      out.push(point('diversion', strike, 'CE'), point('end_of_diversion', strike, 'PE'));
    } else {
      const strike = hi - i * s.step;
      out.push(point('diversion', strike, 'PE'), point('end_of_diversion', strike, 'CE'));
    }
  }
  return out;
}
