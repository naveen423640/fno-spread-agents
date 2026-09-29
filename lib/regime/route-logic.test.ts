import { describe, expect, it } from 'vitest';

import fixture from '@/tests/fixtures/regime-fixture.json';

import { buildRegimeResponse } from './build-response';
import type { Candle } from './types';

// The fixture is weekday-only and ends on Tue 2026-09-29.
const candles: Candle[] = fixture.dates.map((date, i) => ({ date, close: fixture.closes[i] }));
const params = { symbol: 'NSE:TCS-EQ', window: 10 as const, method: 'vol' as const, horizon: 5 as const, asOf: null };

function ok(response: ReturnType<typeof buildRegimeResponse>) {
  if ('error' in response) throw new Error(`expected data, got ${response.code}`);
  return response;
}

describe('buildRegimeResponse', () => {
  it('drops a still-forming candle for today while the market is open', () => {
    const now = new Date('2026-09-29T04:30:00Z'); // Tue 10:00 IST: the 09-29 candle is not final
    const response = ok(buildRegimeResponse({ candles, params, now }));
    expect(response.analysis.dates.includes('2026-09-29')).toBe(false);
    expect(response.analysis.asOf).toBe('2026-09-28');
    expect(response.dataSource.expectedLastSession).toBe('2026-09-28');
  });

  it('drops the forming candle even when the caller asks for today as the as-of date', () => {
    const now = new Date('2026-09-29T04:30:00Z'); // Tue 10:00 IST
    const response = ok(buildRegimeResponse({ candles, params: { ...params, asOf: '2026-09-29' }, now }));
    expect(response.analysis.dates.includes('2026-09-29')).toBe(false);
    expect(response.analysis.asOf).toBe('2026-09-28');
  });

  it('keeps today\'s candle after 15:30 IST', () => {
    const now = new Date('2026-09-30T10:30:00Z'); // Wed 16:00 IST
    const response = ok(buildRegimeResponse({ candles: [...candles, { date: '2026-09-30', close: 999 }], params, now }));
    expect(response.analysis.dates.at(-1)).toBe('2026-09-30');
  });

  it('is not stale when the newest candle is the last completed session', () => {
    const response = ok(buildRegimeResponse({ candles, params, now: new Date('2026-09-30T04:30:00Z') })); // Wed 10:00, expects 09-29
    expect(response.dataSource.lastCandleDate).toBe('2026-09-29');
    expect(response.dataSource.stale).toBe(false);
    expect(response.dataSource.staleNote).toBeNull();
  });

  it('marks data stale, with a note, when the newest candle is older than the last completed session', () => {
    const response = ok(buildRegimeResponse({ candles, params, now: new Date('2026-10-05T04:30:00Z') })); // Mon 10:00, expects Fri 10-02
    expect(response.dataSource.stale).toBe(true);
    expect(response.dataSource.staleNote).toMatch(/possibly stale/i);
    expect(response.dataSource.staleNote).toContain('2026-10-02');
  });

  it('honours an explicit as-of date and never uses later closes', () => {
    const response = ok(buildRegimeResponse({ candles, params: { ...params, asOf: fixture.dates[300] }, now: new Date('2027-01-01T04:30:00Z') }));
    expect(response.analysis.asOf).toBe(fixture.dates[300]);
    expect(response.analysis.dates.at(-1)).toBe(fixture.dates[300]);
  });

  it('is not stale for a historical as-of date, even though newer sessions exist', () => {
    const response = ok(buildRegimeResponse({ candles, params: { ...params, asOf: fixture.dates[300] }, now: new Date('2027-01-01T04:30:00Z') }));
    expect(response.dataSource.stale).toBe(false);
    expect(response.dataSource.staleNote).toBeNull();
  });

  it('is still stale when the as-of date is today or later and the newest candle is old', () => {
    const response = ok(buildRegimeResponse({ candles, params: { ...params, asOf: '2026-10-05' }, now: new Date('2026-10-05T04:30:00Z') }));
    expect(response.dataSource.stale).toBe(true);
  });

  it('reports lastCandleDate as the newest candle at or before the as-of date', () => {
    const response = ok(buildRegimeResponse({ candles, params: { ...params, asOf: fixture.dates[300] }, now: new Date('2027-01-01T04:30:00Z') }));
    expect(response.dataSource.lastCandleDate).toBe(fixture.dates[300]);
  });

  it('returns NO_DATA when there are no candles', () => {
    expect(buildRegimeResponse({ candles: [], params, now: new Date() })).toMatchObject({ code: 'NO_DATA' });
  });

  it('returns NO_DATA when every candle is later than the last completed session', () => {
    expect(buildRegimeResponse({ candles, params, now: new Date('2025-01-01T04:30:00Z') })).toMatchObject({ code: 'NO_DATA' });
  });

  it('reports the adjustment status as unverified until Task 8 records evidence', () => {
    const response = ok(buildRegimeResponse({ candles, params, now: new Date('2027-01-01T04:30:00Z') }));
    expect(response.dataSource.adjustment).toBe('unverified');
    expect(response.dataSource.adjustmentNote).toMatch(/unverified/i);
  });

  it('carries the requested symbol and the analysis parameters through', () => {
    const response = ok(buildRegimeResponse({ candles, params: { ...params, window: 40, method: 'fixed', horizon: 10 }, now: new Date('2027-01-01T04:30:00Z') }));
    expect(response.symbol).toBe('NSE:TCS-EQ');
    expect(response.analysis).toMatchObject({ window: 40, method: 'fixed', horizon: 10 });
  });
});
