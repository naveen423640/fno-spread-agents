import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EMPTY_PRIOR, scanSymbol, type C5, type PriorTotals, type ScanResult } from '@/lib/vwap/core';

// Real 5-minute candles for 1-7 October 2026 (the month's sessions: 1, 5, 6 and 7 October; 2 October was a holiday), exported from
// the FYERS history cache. The month VWAP is anchored at the first candle of 1 October.
type Fixture = { days: Record<string, number[][]> };
const load = (name: string): Fixture => JSON.parse(readFileSync(`tests/fixtures/vwap/${name}.json`, 'utf8')) as Fixture;
const candles = (rows: number[][]): C5[] => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

// Scans one day, carrying the month totals forward from the sessions before it.
function scanDay(name: string, day: string): ScanResult {
  const fixture = load(name);
  let totals: PriorTotals = EMPTY_PRIOR;
  for (const d of Object.keys(fixture.days).filter((x) => x < day).sort()) totals = scanSymbol(totals, candles(fixture.days[d])).totals;
  return scanSymbol(totals, candles(fixture.days[day]));
}

const within = (actual: number, expected: number, pct = 0.1) => Math.abs(actual - expected) / expected <= pct / 100;
const brief = (r: ScanResult) => r.events.map((e) => `${e.time} ${e.direction}`);

describe('golden: 7 October 2026 on real 5-minute data', () => {
  it('TCS crosses up at the 10:40 candle with the VWAP near 2092.6', () => {
    const r = scanDay('tcs', '2026-10-07');
    const up = r.events.find((e) => e.time === '10:40');
    expect(up).toBeDefined();
    expect(up!.direction).toBe('up');
    expect(within(up!.vwap, 2092.6)).toBe(true);
    expect(up!.borderline).toBe(true); // closed 0.015% above the line
  });

  it('OFSS crosses up at 09:25 with the VWAP near 10481.3', () => {
    const r = scanDay('ofss', '2026-10-07');
    const up = r.events.find((e) => e.time === '09:25');
    expect(up).toBeDefined();
    expect(up!.direction).toBe('up');
    expect(within(up!.vwap, 10481.3)).toBe(true);
    expect(up!.borderline).toBe(false);
  });

  it('LTM crosses up 10:15, down 10:20, up 10:45, down 11:00 with the VWAP near 3999.5', () => {
    const r = scanDay('ltm', '2026-10-07');
    expect(brief(r)).toEqual(['10:15 up', '10:20 down', '10:45 up', '11:00 down']);
    for (const e of r.events) expect(within(e.vwap, 3999.5)).toBe(true);
    // The two 4 to 5 paise closes are borderline; the 10:20 drop of about 20 rupees is not.
    expect(r.events.map((e) => e.borderline)).toEqual([true, false, true, true]);
  });

  it('every candle in the fixtures is a closed 5-minute candle on the 09:15 grid', () => {
    for (const name of ['tcs', 'ofss', 'ltm']) {
      for (const rows of Object.values(load(name).days)) {
        expect(rows).toHaveLength(75);
        expect(rows.every(([t]) => (t - Date.parse('2026-10-07T09:15:00+05:30') / 1000) % 300 === 0)).toBe(true);
      }
    }
  });
});

describe('golden: same data, different views', () => {
  it('scanning with a clock before the 10:40 candle closes leaves the cross out; after it closes, it is in', () => {
    const fixture = load('tcs');
    let totals: PriorTotals = EMPTY_PRIOR;
    for (const d of ['2026-10-01', '2026-10-05', '2026-10-06']) totals = scanSymbol(totals, candles(fixture.days[d])).totals;
    const today = candles(fixture.days['2026-10-07']);
    const tenForty = Date.parse('2026-10-07T10:40:00+05:30') / 1000;
    expect(scanSymbol(totals, today, { now: tenForty + 299 }).events.some((e) => e.time === '10:40')).toBe(false);
    expect(scanSymbol(totals, today, { now: tenForty + 300 }).events.some((e) => e.time === '10:40')).toBe(true);
  });

  it('the first session of the month (1 October) reports no cross on its first candle', () => {
    const r = scanDay('tcs', '2026-10-01');
    expect(r.events.find((e) => e.time === '09:15')).toBeUndefined();
    expect(r.flags.join(' ')).toMatch(/first session of the month/);
  });
});
