import { describe, expect, it } from 'vitest';

import { probeHistoryDepth } from '@/lib/vwap/depth';
import type { C5 } from '@/lib/vwap/core';
import type { DataProvider } from '@/lib/vwap/provider';

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayCandle = (day: string): C5 => ({ t: Date.parse(`${day}T09:15:00+05:30`) / 1000, o: 1, h: 1, l: 1, c: 1, v: 1 });

// A provider that has one candle per weekday from `oldest` onward and records each request.
function providerFrom(oldest: string, failAbove?: number) {
  const calls: { from: string; to: string }[] = [];
  const provider: DataProvider = {
    name: 'fake',
    async candles5m(_s, from, to) {
      calls.push({ from, to });
      if (failAbove !== undefined && calls.length > failAbove) return { ok: false, code: 'UPSTREAM', message: 'Invalid input' };
      const out: C5[] = [];
      for (let d = from < oldest ? oldest : from; d <= to; d = addDays(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() % 6 !== 0) out.push(weekdayCandle(d));
      return { ok: true, value: out };
    },
  };
  return { provider, calls };
}

describe('probeHistoryDepth', () => {
  it('finds the oldest session when the data begins inside a window and stops there', async () => {
    const { provider, calls } = providerFrom('2026-03-02');
    const r = await probeHistoryDepth(provider, 'NSE:TCS-EQ', '2026-10-12');
    expect(r.earliestDay).toBe('2026-03-02');
    expect(r.stoppedBecause).toBe('no older data');
    expect(calls.length).toBe(3); // 100 days each: 3 Jul-12 Oct, 24 Mar-2 Jul... the third window holds the start
    expect(r.windows[0]).toMatchObject({ to: '2026-10-12' });
    expect(r.sessionsSeen).toBeGreaterThan(100);
  });

  it('stops when a window comes back empty', async () => {
    const { provider } = providerFrom('2026-07-20');
    const r = await probeHistoryDepth(provider, 'NSE:TCS-EQ', '2026-10-12');
    expect(r.earliestDay).toBe('2026-07-20');
    expect(r.stoppedBecause).toBe('no older data');
    expect(r.windows).toHaveLength(1); // the first window already starts well inside its range
  });

  it('reports a FYERS refusal as the reason it stopped, keeping what it found', async () => {
    const { provider } = providerFrom('2020-01-01', 1);
    const r = await probeHistoryDepth(provider, 'NSE:TCS-EQ', '2026-10-12');
    expect(r.stoppedBecause).toBe('error');
    expect(r.error).toBe('Invalid input');
    expect(r.earliestDay).not.toBeNull();
  });

  it('gives up after the window limit when data goes back further', async () => {
    const { provider, calls } = providerFrom('2015-01-01');
    const r = await probeHistoryDepth(provider, 'NSE:TCS-EQ', '2026-10-12', { maxWindows: 4 });
    expect(calls).toHaveLength(4);
    expect(r.stoppedBecause).toBe('window limit');
  });

  it('lists only months whose first real session is present', async () => {
    const { provider } = providerFrom('2026-07-06'); // July opened on the 1st, so July is incomplete
    const r = await probeHistoryDepth(provider, 'NSE:TCS-EQ', '2026-10-12');
    expect(r.monthsFullyCovered).toEqual(['2026-08', '2026-09', '2026-10']);
  });
});
