import { describe, expect, it } from 'vitest';

import { classifyTrend, COA2_TABLE, selectCoa2, type Trend } from '@/lib/ltp/coa2';
import { LTP_CONFIG } from '@/lib/ltp/config';
import { istDate, istHhmm, istTs } from '@/lib/ltp/time';

const at = (hhmm: string, date = '2026-10-12') => istTs(date, hhmm);

describe('IST helpers', () => {
  it('round-trips a time and reads the IST date and clock', () => {
    const t = istTs('2026-10-12', '09:20');
    expect(istHhmm(t)).toBe('09:20');
    expect(istDate(t)).toBe('2026-10-12');
    expect(istHhmm(istTs('2026-10-12', '15:30'))).toBe('15:30');
  });
});

describe('classifyTrend (C6)', () => {
  const series = (start: number, end: number, now = at('11:00')) => [
    { ts: now - 30 * 60, oi: start }, { ts: now - 15 * 60, oi: (start + end) / 2 }, { ts: now, oi: end },
  ];
  it('exactly +/-5% over the lookback is stable; beyond it is increasing or decreasing', () => {
    expect(classifyTrend(series(100, 105), at('11:00'), LTP_CONFIG)).toBe('stable');
    expect(classifyTrend(series(100, 95), at('11:00'), LTP_CONFIG)).toBe('stable');
    expect(classifyTrend(series(100, 105.01), at('11:00'), LTP_CONFIG)).toBe('increasing');
    expect(classifyTrend(series(100, 94.99), at('11:00'), LTP_CONFIG)).toBe('decreasing');
  });
  it('uses only points inside the lookback window, ignoring older ones', () => {
    const now = at('11:00');
    const s = [{ ts: now - 120 * 60, oi: 10 }, { ts: now - 30 * 60, oi: 100 }, { ts: now, oi: 101 }];
    expect(classifyTrend(s, now, LTP_CONFIG)).toBe('stable');
  });
  it('returns null with fewer than two points in the window, or when the starting OI is not above zero', () => {
    const now = at('11:00');
    expect(classifyTrend([{ ts: now, oi: 100 }], now, LTP_CONFIG)).toBeNull();
    expect(classifyTrend([], now, LTP_CONFIG)).toBeNull();
    expect(classifyTrend([{ ts: now - 600, oi: 0 }, { ts: now, oi: 50 }], now, LTP_CONFIG)).toBeNull();
  });
});

describe('selectCoa2 (C6)', () => {
  const BRIEF: [Trend, Trend, number, string][] = [
    ['increasing', 'increasing', 1, 'Reversal at both; consolidation'],
    ['increasing', 'stable', 2, 'Reversal at resistance; support may break'],
    ['increasing', 'decreasing', 3, 'Reversal at resistance; support will break'],
    ['stable', 'increasing', 4, 'Reversal at support; resistance may break out'],
    ['stable', 'stable', 5, 'Reversal at both; consolidation'],
    ['stable', 'decreasing', 6, 'Reversal at resistance; support may break'],
    ['decreasing', 'increasing', 7, 'Reversal at support; resistance may break out'],
    ['decreasing', 'stable', 8, 'Reversal at support; resistance will break out'],
    ['decreasing', 'decreasing', 9, 'Unpredictable; avoid'],
  ];
  it('has the nine combinations', () => { expect(Object.keys(COA2_TABLE)).toHaveLength(9); });
  for (const [call, put, number, outcome] of BRIEF) {
    it(`scenario ${number}: call OI ${call}, put OI ${put}`, () => {
      expect(selectCoa2(call, put, '10:30', { firstHitOfExtension: false })).toEqual({ status: 'ok', number, outcome });
    });
  }
  it('is only valid from 09:45 to 14:30 IST (both ends inside)', () => {
    for (const t of ['09:40', '09:44', '14:31', '14:35']) expect(selectCoa2('stable', 'stable', t, { firstHitOfExtension: false }).status).toBe('outside_window');
    for (const t of ['09:45', '14:30']) expect(selectCoa2('stable', 'stable', t, { firstHitOfExtension: false }).status).toBe('ok');
  });
  it('is not used on the first hit of an extension, but may be from the second', () => {
    expect(selectCoa2('stable', 'stable', '10:30', { firstHitOfExtension: true }).status).toBe('not_on_first_hit');
    expect(selectCoa2('stable', 'stable', '10:30', { firstHitOfExtension: false }).status).toBe('ok');
  });
  it('says there is no data when a trend could not be classified', () => {
    expect(selectCoa2(null, 'stable', '10:30', { firstHitOfExtension: false }).status).toBe('no_data');
  });
});
