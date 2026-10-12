import { describe, expect, it } from 'vitest';

import { LTP_CONFIG } from '@/lib/ltp/config';
import { valueAt } from '@/lib/ltp/types';
import { makeChain } from '../support/ltp-chain';

describe('LTP_CONFIG defaults from the brief', () => {
  it('has the documented thresholds', () => {
    expect(LTP_CONFIG.weakThresholdPct).toBe(75);
    expect(LTP_CONFIG.strikecount).toBe(20);
    expect(LTP_CONFIG.coa2).toMatchObject({ stableBandPct: 5, lookbackMin: 30, windowStart: '09:45', windowEnd: '14:30' });
    expect(LTP_CONFIG.soc.oneHour).toMatchObject({ minutes: 60, rangeMin: 2, rangeMax: 5 });
    expect(LTP_CONFIG.soc.twoHour).toMatchObject({ minutes: 120, rangeMin: 10, rangeMax: 15 });
    expect(LTP_CONFIG.soc.threeHour.minutes).toBe(180);
    expect(LTP_CONFIG.lines0920).toMatchObject({ time: '09:20', stopBufferPoints: 10 });
    expect(LTP_CONFIG.expectedStep['NSE:NIFTY50-INDEX']).toBe(50);
    expect(LTP_CONFIG.expectedStep['NSE:NIFTYBANK-INDEX']).toBe(100);
    expect(LTP_CONFIG.expectedStep['BSE:SENSEX-INDEX']).toBe(100);
  });
});

describe('makeChain and valueAt', () => {
  it('builds strikes around the spot with deterministic defaults', () => {
    const s = makeChain({ spot: 24037, step: 50 });
    const strikes = [...new Set(s.rows.map((r) => r.strike))];
    expect(strikes).toContain(24000);
    expect(strikes).toContain(24050);
    expect(strikes.length).toBeGreaterThanOrEqual(20);
    expect(s.step).toBe(50);
    expect(valueAt(s, 24000, 'CE', 'volume')).toBe(1000);
    expect(valueAt(s, 24000, 'PE', 'ltp')).toBe(100);
  });

  it('applies overrides to one cell only and returns null for a strike not in the chain', () => {
    const s = makeChain({ spot: 24037, step: 50, ce: { 24100: { volume: 5000, oi: 7000 } }, pe: { 23900: { oi: null } } });
    expect(valueAt(s, 24100, 'CE', 'volume')).toBe(5000);
    expect(valueAt(s, 24100, 'CE', 'oi')).toBe(7000);
    expect(valueAt(s, 24100, 'PE', 'volume')).toBe(1000);
    expect(valueAt(s, 23900, 'PE', 'oi')).toBeNull();
    expect(valueAt(s, 99999, 'CE', 'oi')).toBeNull();
  });

  it('accepts an explicit list of strikes and a timestamp', () => {
    const s = makeChain({ spot: 100, step: 10, strikes: [90, 100, 110], ts: 1_000 });
    expect([...new Set(s.rows.map((r) => r.strike))]).toEqual([90, 100, 110]);
    expect(s.ts).toBe(1_000);
  });
});
