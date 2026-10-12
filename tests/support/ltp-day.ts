import { istTs } from '@/lib/ltp/time';
import type { Snapshot } from '@/lib/ltp/types';

import { makeChain } from './ltp-chain';

// A deterministic synthetic session: 376 snapshots, one per minute from 09:15 to 15:30 IST. The spot drifts on a sine wave, the put wall
// sits at 23900 and the call wall at 24200, and the put second-highest at 23850 swells and fades so the support strength changes over the day.
export function syntheticDay(date = '2026-10-12', underlying = 'NSE:NIFTY50-INDEX'): Snapshot[] {
  const out: Snapshot[] = [];
  for (let i = 0; i <= 375; i += 1) {
    const minutes = 9 * 60 + 15 + i;
    const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const spot = Math.round((24037 + 30 * Math.sin(i / 20)) * 100) / 100;
    const growth = 10_000 + i * 40; // the walls build up through the day
    const second = growth * (0.6 + 0.35 * Math.abs(Math.sin(i / 90))); // pct of the put second-highest wanders between 60% and 95%
    out.push(makeChain({
      spot, step: 50, ts: istTs(date, hhmm), underlying,
      pe: { 23900: { volume: growth, oi: growth + 200, ltp: 40 }, 23850: { volume: second, oi: second, ltp: 30 }, 23800: { ltp: 25 } },
      ce: { 24200: { volume: growth, oi: growth * 1.5 - i * 10, ltp: 55 }, 24250: { ltp: 45 }, 24300: { ltp: 35 } },
    }));
  }
  return out;
}
