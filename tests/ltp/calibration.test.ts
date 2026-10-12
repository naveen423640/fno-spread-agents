import { describe, expect, it } from 'vitest';

import { calibrationSummary, CALIBRATION_LABELS, proxiesAt } from '@/lib/ltp/calibration';
import type { CalibrationEntry } from '@/lib/ltp/store';
import { istTs } from '@/lib/ltp/time';
import { syntheticDay } from '../support/ltp-day';

const DAY = '2026-10-12';
const day = syntheticDay(DAY);
const U = 'NSE:NIFTY50-INDEX';
const entry = (id: string, actual: number, proxies: Record<string, number | null>): CalibrationEntry => ({ id, underlying: U, entryTs: 0, label: 'EOS', actual, snapshotTs: 0, proxies });

describe('proxiesAt', () => {
  it('computes the proxy under every method from the nearest snapshot within one minute', () => {
    const r = proxiesAt(day, istTs(DAY, '10:00', 20), 'EOS');
    if (!r.ok) throw new Error(r.message);
    expect(r.snapshotTs).toBe(istTs(DAY, '10:00'));
    expect(r.proxies.writer_breakeven).toBe(23860); // support 23900 less its put LTP of 40
    expect(r.proxies.time_value_only).toBe(23860); // out of the money, so all of the premium is time value
    expect(Object.keys(r.proxies).sort()).toEqual(['time_value_only', 'writer_breakeven']);
  });

  it('covers the extension labels: EOR, EOS-1 and EOR+1', () => {
    const at = istTs(DAY, '11:00');
    const value = (label: string) => { const r = proxiesAt(day, at, label); if (!r.ok) throw new Error(r.message); return r.proxies.writer_breakeven; };
    expect(value('EOR')).toBe(24200 + 55);
    expect(value('EOS-1')).toBe(23850 - 30);
    expect(value('EOR+1')).toBe(24250 + 45);
    expect(CALIBRATION_LABELS).toEqual(['EOS', 'EOR', 'EOS-1', 'EOR+1']);
  });

  it('refuses an entry with no snapshot within one minute, and an unknown label', () => {
    expect(proxiesAt(day, istTs(DAY, '03:00'), 'EOS')).toMatchObject({ ok: false, message: 'No snapshot within one minute of that time.' });
    expect(proxiesAt(day, istTs(DAY, '10:00'), 'EOS+9')).toMatchObject({ ok: false });
    expect(proxiesAt([], istTs(DAY, '10:00'), 'EOS')).toMatchObject({ ok: false });
  });

  it('reads only snapshots up to the matched one (no look-ahead)', () => {
    const early = proxiesAt(day.slice(0, 46), istTs(DAY, '10:00'), 'EOS');
    const full = proxiesAt(day, istTs(DAY, '10:00'), 'EOS');
    expect(early).toEqual(full);
  });
});

describe('calibrationSummary', () => {
  // Three entries; EOS actuals 23860, 24255, 23820 on NIFTY (step 50).
  const entries = [
    entry('a', 23860, { writer_breakeven: 23862.5, time_value_only: 23850 }),
    entry('b', 24255, { writer_breakeven: 24250, time_value_only: 24260 }),
    entry('c', 23820, { writer_breakeven: 23820, time_value_only: 23830 }),
  ];
  const s = calibrationSummary(entries);

  it('mean absolute error, median error and error in strike steps, by hand: writer breakeven errors +2.5, -5, 0', () => {
    expect(s.writer_breakeven.n).toBe(3);
    expect(s.writer_breakeven.meanAbsError).toBeCloseTo(2.5, 10); // (2.5 + 5 + 0) / 3
    expect(s.writer_breakeven.medianError).toBe(0); // sorted -5, 0, 2.5
    expect(s.writer_breakeven.errorInSteps).toBeCloseTo(2.5 / 50, 10);
  });

  it('time value only errors are -10, +5, +10', () => {
    expect(s.time_value_only.meanAbsError).toBeCloseTo(25 / 3, 10);
    expect(s.time_value_only.medianError).toBe(5);
    expect(s.time_value_only.errorInSteps).toBeCloseTo(25 / 3 / 50, 10);
  });

  it('leaves out entries where a method had no value, and reports null with no entries at all', () => {
    const withNull = calibrationSummary([...entries, entry('d', 24000, { writer_breakeven: null, time_value_only: 24010 })]);
    expect(withNull.writer_breakeven.n).toBe(3);
    expect(withNull.time_value_only.n).toBe(4);
    expect(calibrationSummary([])).toEqual({});
  });

  it('uses each entry\'s own strike step: BANKNIFTY errors count in steps of 100', () => {
    const bank: CalibrationEntry = { ...entry('x', 55000, { writer_breakeven: 55010 }), underlying: 'NSE:NIFTYBANK-INDEX' };
    expect(calibrationSummary([bank]).writer_breakeven.errorInSteps).toBeCloseTo(0.1, 10);
  });
});
