import { describe, expect, it } from 'vitest';

import { firstOtmLtps, weeklyRange, weeklyRangeFromSnapshots } from '@/lib/ltp/weekly';
import { istTs } from '@/lib/ltp/time';
import { makeChain } from '../support/ltp-chain';

describe('weeklyRange (C10)', () => {
  it('CMP 23,432.20 with CE 163.10 and PE 121.05 gives S 284.15 and the three bands from the brief', () => {
    const r = weeklyRange(23432.2, 163.1, 121.05, { lateStart: false });
    expect(r.s).toBeCloseTo(284.15, 2);
    expect(r.l1[0]).toBeCloseTo(23148.05, 2); expect(r.l1[1]).toBeCloseTo(23716.35, 2);
    expect(r.l2[0]).toBeCloseTo(22863.9, 2); expect(r.l2[1]).toBeCloseTo(24000.5, 2);
    expect(r.l3[0]).toBeCloseTo(22579.75, 2); expect(r.l3[1]).toBeCloseTo(24284.65, 2);
    expect(r.lateStart).toBe(false);
  });
  it('carries the late-start flag through', () => {
    expect(weeklyRange(100, 1, 1, { lateStart: true }).lateStart).toBe(true);
  });
});

describe('firstOtmLtps', () => {
  it('takes the first call strike above the spot and the first put strike below it', () => {
    const s = makeChain({ spot: 24037, step: 50, ce: { 24050: { ltp: 163.1 } }, pe: { 24000: { ltp: 121.05 } } });
    expect(firstOtmLtps(s)).toEqual({ ce: 163.1, pe: 121.05, ceStrike: 24050, peStrike: 24000 });
  });
  it('a spot exactly on a strike uses the next strike up for the call and down for the put', () => {
    const s = makeChain({ spot: 24050, step: 50, ce: { 24100: { ltp: 90 } }, pe: { 24000: { ltp: 80 } } });
    expect(firstOtmLtps(s)).toMatchObject({ ceStrike: 24100, peStrike: 24000, ce: 90, pe: 80 });
  });
  it('is null when either price is missing', () => {
    expect(firstOtmLtps(makeChain({ spot: 24037, step: 50, ce: { 24050: { ltp: null } } }))).toBeNull();
  });
});

describe('weeklyRangeFromSnapshots', () => {
  const day = '2026-10-12';
  const chainAt = (hhmm: string) => makeChain({ spot: 24037, step: 50, ts: istTs(day, hhmm, 3), ce: { 24050: { ltp: 163.1 } }, pe: { 24000: { ltp: 121.05 } } });
  it('uses the 09:15 snapshot of the first day of the week', () => {
    const r = weeklyRangeFromSnapshots([chainAt('09:16'), chainAt('09:15')])!;
    expect(r.lateStart).toBe(false);
    expect(r.s).toBeCloseTo(284.15, 2);
    expect(r.snapshotTs).toBe(istTs(day, '09:15', 3));
  });
  it('falls back to the first snapshot of the day and flags late_start when 09:15 was missed', () => {
    const r = weeklyRangeFromSnapshots([chainAt('09:22'), chainAt('09:23')])!;
    expect(r.lateStart).toBe(true);
    expect(r.snapshotTs).toBe(istTs(day, '09:22', 3));
  });
  it('is null with no snapshots or with missing option prices', () => {
    expect(weeklyRangeFromSnapshots([])).toBeNull();
    expect(weeklyRangeFromSnapshots([makeChain({ spot: 24037, step: 50, ce: { 24050: { ltp: null } } })])).toBeNull();
  });
});
