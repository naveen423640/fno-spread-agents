// C10 the weekly range: the day's CMP plus or minus one, two and three times the sum of the first out-of-the-money call and put LTPs.
import { istHhmm } from './time';
import { strikesOf, valueAt, type Snapshot } from './types';

export type WeeklyRange = { s: number; l1: [number, number]; l2: [number, number]; l3: [number, number]; lateStart: boolean };
export type WeeklyFromSnapshots = WeeklyRange & { snapshotTs: number; cmp: number; ce: number; pe: number; ceStrike: number; peStrike: number };

const r2 = (x: number) => Math.round(x * 100) / 100;

export function weeklyRange(cmp: number, ce: number, pe: number, opts: { lateStart: boolean }): WeeklyRange {
  const s = ce + pe;
  const band = (n: number): [number, number] => [r2(cmp - n * s), r2(cmp + n * s)];
  return { s: r2(s), l1: band(1), l2: band(2), l3: band(3), lateStart: opts.lateStart };
}

// The first call strike above the spot and the first put strike below it (a spot on a strike uses the next one out). Null if either LTP is missing.
export function firstOtmLtps(s: Snapshot): { ce: number; pe: number; ceStrike: number; peStrike: number } | null {
  const strikes = strikesOf(s);
  const ceStrike = strikes.find((k) => k > s.spot);
  const peStrike = [...strikes].reverse().find((k) => k < s.spot);
  if (ceStrike === undefined || peStrike === undefined) return null;
  const ce = valueAt(s, ceStrike, 'CE', 'ltp');
  const pe = valueAt(s, peStrike, 'PE', 'ltp');
  return ce === null || pe === null ? null : { ce, pe, ceStrike, peStrike };
}

// `snaps` are the snapshots of the first trading day of the expiry week. The range uses the 09:15 snapshot; if that minute was missed, the first
// snapshot of the day is used and the range is flagged late_start.
export function weeklyRangeFromSnapshots(snaps: Snapshot[]): WeeklyFromSnapshots | null {
  if (!snaps.length) return null;
  const first = [...snaps].sort((a, b) => a.ts - b.ts)[0];
  const otm = firstOtmLtps(first);
  if (!otm) return null;
  const range = weeklyRange(first.spot, otm.ce, otm.pe, { lateStart: istHhmm(first.ts) !== '09:15' });
  return { ...range, snapshotTs: first.ts, cmp: first.spot, ...otm };
}
