import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { deriveStep, nearestExpiry, parseChain } from '@/lib/ltp/chain';
import { istTs } from '@/lib/ltp/time';
import { valueAt } from '@/lib/ltp/types';

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/ltp/${name}-chain.json`, 'utf8')) as { data: { optionsChain: Record<string, unknown>[]; expiryData: { date: string }[] } };
const ts = istTs('2026-10-12', '10:00', 5);
const ctx = (underlying: string, over: Partial<{ snapshotTs: number; latencyMs: number | null }> = {}) => ({ underlying, snapshotTs: ts, latencyMs: 120, ...over });

describe('parseChain on the real FYERS responses', () => {
  it('NIFTY: spot, rows, step 50 and the nearest expiry from the real chain', () => {
    const r = parseChain(fixture('nifty'), ctx('NSE:NIFTY50-INDEX'));
    if (!r.ok) throw new Error(r.message);
    const s = r.snapshot;
    expect(s).toMatchObject({ ts, underlying: 'NSE:NIFTY50-INDEX', expiry: '2026-10-13', spot: 22583.15, step: 50, fetchLatencyMs: 120 });
    expect(s.rows).toHaveLength(5); // the index row is the spot, not a strike
    expect(valueAt(s, 22350, 'PE', 'ltp')).toBe(21.3);
    expect(valueAt(s, 22350, 'PE', 'oi')).toBe(5679375);
    expect(valueAt(s, 22350, 'PE', 'oiChange')).toBe(561795);
    expect(valueAt(s, 22350, 'PE', 'volume')).toBe(10061545);
    expect(valueAt(s, 22350, 'CE', 'oiChange')).toBe(-119410);
    expect(r.warnings).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it('BANKNIFTY: step 100 and the monthly expiry, with no warning', () => {
    const r = parseChain(fixture('banknifty'), ctx('NSE:NIFTYBANK-INDEX'));
    if (!r.ok) throw new Error(r.message);
    expect(r.snapshot).toMatchObject({ step: 100, expiry: '2026-10-27', spot: 55120.3 });
    expect(r.warnings).toEqual([]);
  });

  it('SENSEX on BSE: step 100 and the weekly expiry', () => {
    const r = parseChain(fixture('sensex'), ctx('BSE:SENSEX-INDEX'));
    if (!r.ok) throw new Error(r.message);
    expect(r.snapshot).toMatchObject({ step: 100, expiry: '2026-10-15', spot: 72552.7, underlying: 'BSE:SENSEX-INDEX' });
  });

  it('warns when the derived step differs from the expected one for that underlying', () => {
    const r = parseChain(fixture('nifty'), ctx('NSE:NIFTYBANK-INDEX')); // NIFTY's 50-point strikes under BANKNIFTY's expected 100
    if (!r.ok) throw new Error(r.message);
    expect(r.warnings.join(' ')).toMatch(/derived strike step 50 differs from the expected 100/);
    expect(r.snapshot.step).toBe(50); // the derived value is used, not the expected one
  });
});

describe('missing and odd values', () => {
  it('a missing field is stored as null, flagged on the row and listed, never replaced by zero', () => {
    const f = fixture('nifty');
    delete f.data.optionsChain[1].volume;
    const r = parseChain(f, ctx('NSE:NIFTY50-INDEX'));
    if (!r.ok) throw new Error(r.message);
    const row = r.snapshot.rows.find((x) => x.strike === 22350 && x.side === 'PE')!;
    expect(row.volume).toBeNull();
    expect(row.flags).toEqual(['volume']);
    expect(r.missing).toEqual(['PE 22350 volume']);
  });

  it('reads numbers given as numeric strings, and treats non-numeric text as missing', () => {
    const f = fixture('nifty');
    f.data.optionsChain[1].ltp = '21.5';
    f.data.optionsChain[1].oi = 'n/a';
    const r = parseChain(f, ctx('NSE:NIFTY50-INDEX'));
    if (!r.ok) throw new Error(r.message);
    expect(valueAt(r.snapshot, 22350, 'PE', 'ltp')).toBe(21.5);
    expect(valueAt(r.snapshot, 22350, 'PE', 'oi')).toBeNull();
  });

  it('ignores a duplicated strike and side, keeping the first, and says so', () => {
    const f = fixture('nifty');
    f.data.optionsChain.push({ ...f.data.optionsChain[1], ltp: 999 });
    const r = parseChain(f, ctx('NSE:NIFTY50-INDEX'));
    if (!r.ok) throw new Error(r.message);
    expect(valueAt(r.snapshot, 22350, 'PE', 'ltp')).toBe(21.3);
    expect(r.warnings.join(' ')).toMatch(/duplicate/);
  });
});

describe('failures are explicit, never stale or invented data', () => {
  it('maps a FYERS auth failure to login_required', () => {
    expect(parseChain({ s: 'error', code: -16, message: 'token expired' }, ctx('NSE:NIFTY50-INDEX'))).toMatchObject({ ok: false, reason: 'login_required' });
  });
  it('maps any other error status to upstream and keeps FYERS\'s message', () => {
    expect(parseChain({ s: 'error', code: -300, message: 'boom' }, ctx('NSE:NIFTY50-INDEX'))).toMatchObject({ ok: false, reason: 'upstream', message: 'boom' });
  });
  it('an ok response with no option legs is empty', () => {
    expect(parseChain({ s: 'ok', data: { optionsChain: [], expiryData: [{ date: '13-10-2026' }] } }, ctx('NSE:NIFTY50-INDEX'))).toMatchObject({ ok: false, reason: 'empty' });
  });
  it('a chain with no spot row, no expiry list or the wrong shape is malformed', () => {
    const noSpot = fixture('nifty');
    noSpot.data.optionsChain.shift();
    expect(parseChain(noSpot, ctx('NSE:NIFTY50-INDEX'))).toMatchObject({ ok: false, reason: 'malformed' });
    const noExpiry = fixture('nifty');
    noExpiry.data.expiryData = [];
    expect(parseChain(noExpiry, ctx('NSE:NIFTY50-INDEX'))).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parseChain('nope', ctx('NSE:NIFTY50-INDEX'))).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parseChain(null, ctx('NSE:NIFTY50-INDEX'))).toMatchObject({ ok: false, reason: 'malformed' });
  });
  it('a single strike cannot give a step and is empty', () => {
    const f = fixture('nifty');
    f.data.optionsChain = f.data.optionsChain.filter((l) => l.option_type === '' || l.strike_price === 22350);
    expect(parseChain(f, ctx('NSE:NIFTY50-INDEX'))).toMatchObject({ ok: false, reason: 'empty' });
  });
});

describe('deriveStep and nearestExpiry', () => {
  it('the step is the most common difference between neighbouring strikes, and ignores one odd gap', () => {
    expect(deriveStep([100, 150, 200, 250, 350])).toBe(50);
    expect(deriveStep([22350, 22400, 22450])).toBe(50);
    expect(deriveStep([100])).toBeNull();
    expect(deriveStep([])).toBeNull();
    expect(deriveStep([100, 100, 100])).toBeNull();
  });
  it('picks the first expiry that is today or later', () => {
    const list = ['13-10-2026', '19-10-2026', '27-10-2026'];
    expect(nearestExpiry(list, istTs('2026-10-12', '10:00'))).toBe('2026-10-13');
    expect(nearestExpiry(list, istTs('2026-10-14', '10:00'))).toBe('2026-10-19');
    expect(nearestExpiry(['01-10-2026'], istTs('2026-10-12', '10:00'))).toBeNull();
    expect(nearestExpiry([], ts)).toBeNull();
  });
  it('on expiry day today\'s expiry is used until 15:30 and the next one after', () => {
    const list = ['13-10-2026', '19-10-2026'];
    expect(nearestExpiry(list, istTs('2026-10-13', '15:29', 59))).toBe('2026-10-13');
    expect(nearestExpiry(list, istTs('2026-10-13', '15:30', 0))).toBe('2026-10-13');
    expect(nearestExpiry(list, istTs('2026-10-13', '15:31', 0))).toBe('2026-10-19');
  });
});
