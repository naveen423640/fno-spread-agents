import { describe, expect, it } from 'vitest';

import { parseRegimeParams } from './params';

const universe = new Set(['NSE:TCS-EQ', 'NSE:SBIN-EQ']);
const parse = (query: string) => parseRegimeParams(new URLSearchParams(query), universe);

describe('parseRegimeParams', () => {
  it('applies defaults', () => {
    expect(parse('symbol=NSE:TCS-EQ')).toEqual({ ok: true, value: { symbol: 'NSE:TCS-EQ', window: 20, method: 'vol', horizon: 5, asOf: null } });
  });

  it('accepts every allowed window, method and horizon', () => {
    for (const w of [10, 20, 40, 60]) for (const m of ['vol', 'fixed']) for (const h of [1, 5, 10]) {
      expect(parse(`symbol=NSE:TCS-EQ&window=${w}&method=${m}&horizon=${h}`).ok).toBe(true);
    }
  });

  it('rejects bad input', () => {
    for (const query of [
      '',
      'symbol=NSE:NOPE-EQ',
      'symbol=NSE:TCS-EQ&window=30',
      'symbol=NSE:TCS-EQ&window=abc',
      'symbol=NSE:TCS-EQ&window=',
      'symbol=NSE:TCS-EQ&method=x',
      'symbol=NSE:TCS-EQ&horizon=3',
      'symbol=NSE:TCS-EQ&asOf=2026-13-40',
      'symbol=NSE:TCS-EQ&asOf=2026-02-30',
      'symbol=NSE:TCS-EQ&asOf=yesterday',
    ]) {
      expect(parse(query).ok, query).toBe(false);
    }
  });

  it('accepts a valid asOf date', () => {
    expect(parse('symbol=NSE:TCS-EQ&asOf=2026-09-29')).toMatchObject({ ok: true, value: { asOf: '2026-09-29' } });
  });

  it('returns a message naming the offending parameter', () => {
    expect(parse('symbol=NSE:TCS-EQ&window=30')).toMatchObject({ ok: false, error: expect.stringContaining('window') });
    expect(parse('symbol=NSE:TCS-EQ&horizon=3')).toMatchObject({ ok: false, error: expect.stringContaining('horizon') });
  });
});
