import { describe, expect, it } from 'vitest';

import { createFyersAdapter } from '../../lib/screener/broker/fyers';

const credentials = { clientId: 'CID-100', accessToken: 'tok-SECRET-123' };
const MASTER = [
  '1,HAL 26OCT 4800 CE,14,150,0.05,ISIN,0,09:15-15:30,2026-10-26,NSE:HAL26OCT4800CE,10,HAL,1,1,0',
  '2,HAL 26OCT FUT,11,150,0.05,ISIN,0,09:15-15:30,2026-10-26,NSE:HAL26OCTFUT,10,HAL,1,1,0',
  '3,HALDIA 26OCT 100 CE,14,999,0.05,ISIN,0,09:15-15:30,2026-10-26,NSE:HALDIA26OCT100CE,10,HALDIA,1,1,0',
  '4,RELIANCE 26OCT 1200 PE,14,500,0.05,ISIN,0,09:15-15:30,2026-10-26,NSE:RELIANCE26OCT1200PE,10,RELIANCE,1,1,0',
].join('\n');

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
function setup(handler: Handler) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    headers.push((init.headers ?? {}) as Record<string, string>);
    return handler(url, init);
  }) as unknown as typeof fetch;
  const adapter = createFyersAdapter({ credentials, fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
  return { adapter, urls, headers, sleeps };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
// 2026-10-01 00:00 IST = 2026-09-30T18:30:00Z
const ist = (isoDate: string) => Date.parse(`${isoDate}T00:00:00+05:30`) / 1000;

describe('symbols', () => {
  it('builds the Fyers formats', () => {
    const { adapter } = setup(() => json({}));
    expect(adapter.name).toBe('fyers');
    expect(adapter.equitySymbol('RELIANCE')).toBe('NSE:RELIANCE-EQ');
    expect(adapter.indexSymbol()).toBe('NSE:NIFTY50-INDEX');
    expect(adapter.optionSymbol('RELIANCE', '2026-10-27', 1200, 'PE')).toBe('NSE:RELIANCE26OCT1200PE');
  });
});

describe('history', () => {
  const candle = (date: string, close: number) => [ist(date), close - 1, close + 2, close - 2, close, 1000];

  it('chunks a long range into 360-day requests, throttles between them, and sends only the auth header', async () => {
    const { adapter, urls, headers, sleeps } = setup(() => json({ s: 'ok', candles: [candle('2026-10-01', 100)] }));
    const result = await adapter.history('NSE:HAL-EQ', { from: '2025-01-01', to: '2026-10-01' });
    expect(result.ok).toBe(true);
    expect(urls).toHaveLength(2);
    const first = new URL(urls[0]);
    expect(first.pathname).toBe('/data/history');
    expect(Object.fromEntries(first.searchParams)).toMatchObject({ symbol: 'NSE:HAL-EQ', resolution: 'D', date_format: '1', range_from: '2025-01-01', range_to: '2025-12-27', cont_flag: '1' });
    expect(new URL(urls[1]).searchParams.get('range_from')).toBe('2025-12-28');
    expect(new URL(urls[1]).searchParams.get('range_to')).toBe('2026-10-01');
    expect(sleeps).toEqual([400]);
    expect(headers[0].Authorization).toBe('CID-100:tok-SECRET-123');
    expect(urls.join(' ')).not.toContain('tok-SECRET-123');
  });

  it('parses candles to IST dates, de-duplicates by date and sorts', async () => {
    const { adapter } = setup(() => json({ s: 'ok', candles: [candle('2026-10-01', 105), candle('2026-09-30', 100), candle('2026-10-01', 106)] }));
    const result = await adapter.history('NSE:HAL-EQ', { from: '2026-09-01', to: '2026-10-01' });
    expect(result).toEqual({ ok: true, value: [
      { date: '2026-09-30', open: 99, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2026-10-01', open: 105, high: 108, low: 104, close: 106, volume: 1000 },
    ] });
  });

  it.each([
    ['HTTP 401', () => json({ s: 'error', message: 'nope' }, 401)],
    ['code -16', () => json({ s: 'error', code: -16, message: 'Could not authenticate the user' }, 200)],
    ['code -8', () => json({ s: 'error', code: -8, message: 'token expired' }, 200)],
    ['code -15', () => json({ s: 'error', code: -15, message: 'invalid' }, 200)],
    ['code -17', () => json({ s: 'error', code: -17, message: 'invalid' }, 200)],
  ])('%s means LOGIN_REQUIRED, with no retry', async (_label, respond) => {
    const { adapter, urls } = setup(respond);
    const result = await adapter.history('NSE:HAL-EQ', { from: '2026-09-01', to: '2026-10-01' });
    expect(result).toMatchObject({ ok: false, code: 'LOGIN_REQUIRED' });
    expect(urls).toHaveLength(1);
  });

  it('other failures are UPSTREAM; a network error uses fixed text that never echoes the token', async () => {
    const bad = setup(() => json({ s: 'error', code: -300, message: 'invalid symbol' }));
    expect(await bad.adapter.history('NSE:XX-EQ', { from: '2026-09-01', to: '2026-10-01' })).toMatchObject({ ok: false, code: 'UPSTREAM', message: 'invalid symbol' });
    const down = setup(() => { throw new Error('connect failed for Bearer tok-SECRET-123'); });
    const result = await down.adapter.history('NSE:HAL-EQ', { from: '2026-09-01', to: '2026-10-01' });
    expect(result).toMatchObject({ ok: false, code: 'UPSTREAM' });
    expect(JSON.stringify(result)).not.toContain('tok-SECRET-123');
  });

  it('an empty answer is UPSTREAM, not an empty success', async () => {
    const { adapter } = setup(() => json({ s: 'ok', candles: [] }));
    expect(await adapter.history('NSE:HAL-EQ', { from: '2026-09-01', to: '2026-10-01' })).toMatchObject({ ok: false, code: 'UPSTREAM' });
  });
});

describe('quote', () => {
  it('reads bid, ask, last price and OI from the quotes endpoint', async () => {
    const { adapter, urls } = setup(() => json({ s: 'ok', d: [{ n: 'NSE:HAL26OCT4800CE', s: 'ok', v: { lp: 119, bid: 118.5, ask: 120, oi: 5500 } }] }));
    const result = await adapter.quote('NSE:HAL26OCT4800CE');
    expect(result).toEqual({ ok: true, value: { bid: 118.5, ask: 120, ltp: 119, oi: 5500 } });
    expect(new URL(urls[0]).pathname).toBe('/data/quotes');
    expect(new URL(urls[0]).searchParams.get('symbols')).toBe('NSE:HAL26OCT4800CE');
  });

  it('missing fields come back as null, and zero is kept as zero', async () => {
    const { adapter } = setup(() => json({ s: 'ok', d: [{ n: 'X', s: 'ok', v: { lp: 5, bid: 0 } }] }));
    expect(await adapter.quote('X')).toEqual({ ok: true, value: { bid: 0, ask: null, ltp: 5, oi: null } });
  });

  it('a symbol FYERS does not know is NOT_FOUND; auth errors are LOGIN_REQUIRED', async () => {
    const unknown = setup(() => json({ s: 'ok', d: [{ n: 'X', s: 'error', v: {} }] }));
    expect(await unknown.adapter.quote('X')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const auth = setup(() => json({ s: 'error', code: -16 }, 200));
    expect(await auth.adapter.quote('X')).toMatchObject({ ok: false, code: 'LOGIN_REQUIRED' });
  });
});

describe('lotSize (symbol master)', () => {
  it('finds the lot for an underlying and expiry, matches the whole name, and downloads the master only once', async () => {
    const { adapter, urls } = setup((url) => (url.pathname === '/sym_details/NSE_FO.csv' ? new Response(MASTER) : json({}, 404)));
    expect(await adapter.lotSize('HAL', '2026-10-27')).toEqual({ ok: true, value: 150 });
    expect(await adapter.lotSize('RELIANCE', '2026-10-27')).toEqual({ ok: true, value: 500 });
    expect(urls.filter((u) => u.includes('NSE_FO.csv'))).toHaveLength(1);
  });

  it('does not confuse HAL with HALDIA, and reports NOT_FOUND for an unknown underlying', async () => {
    const { adapter } = setup(() => new Response(MASTER));
    expect(await adapter.lotSize('HALDIA', '2026-10-27')).toEqual({ ok: true, value: 999 });
    expect(await adapter.lotSize('NOSUCH', '2026-10-27')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await adapter.lotSize('HAL', '2026-11-24')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('a failed download is UPSTREAM', async () => {
    const { adapter } = setup(() => new Response('gone', { status: 500 }));
    expect(await adapter.lotSize('HAL', '2026-10-27')).toMatchObject({ ok: false, code: 'UPSTREAM' });
  });
});

describe('optionOi (option chain, nearest expiry only)', () => {
  const chain = {
    s: 'ok',
    data: {
      expiryData: [{ date: '27-10-2026', expiry: '1792000000' }],
      optionsChain: [
        { option_type: '', strike_price: -1, ltp: 4900 },
        { option_type: 'CE', strike_price: 4800, oi: 1234, ltp: 120 },
        { option_type: 'PE', strike_price: 4800, oi: 4321, ltp: 90 },
      ],
    },
  };

  it('returns the OI at a strike when the chain is for the requested expiry', async () => {
    const { adapter, urls } = setup(() => json(chain));
    expect(await adapter.optionOi('HAL', '2026-10-27', 4800, 'CE')).toEqual({ ok: true, value: 1234 });
    expect(await adapter.optionOi('HAL', '2026-10-27', 4800, 'PE')).toEqual({ ok: true, value: 4321 });
    expect(new URL(urls[0]).pathname).toBe('/data/options-chain-v3');
    expect(new URL(urls[0]).searchParams.get('symbol')).toBe('NSE:HAL-EQ');
  });

  it('is null (not an error) when the chain is for another expiry or the strike is not listed', async () => {
    const { adapter } = setup(() => json(chain));
    expect(await adapter.optionOi('HAL', '2026-11-24', 4800, 'CE')).toEqual({ ok: true, value: null });
    expect(await adapter.optionOi('HAL', '2026-10-27', 9999, 'CE')).toEqual({ ok: true, value: null });
  });
});

describe('read-only', () => {
  it('only ever requests the history, quotes, options-chain and symbol-master endpoints', async () => {
    const { adapter, urls } = setup((url) => (url.pathname.endsWith('.csv') ? new Response(MASTER) : url.pathname === '/data/options-chain-v3' ? json({ s: 'ok', data: { expiryData: [], optionsChain: [] } }) : json({ s: 'ok', candles: [[ist('2026-10-01'), 1, 2, 0.5, 1.5, 10]], d: [{ n: 'X', s: 'ok', v: { lp: 1 } }] })));
    await adapter.history('NSE:HAL-EQ', { from: '2026-09-01', to: '2026-10-01' });
    await adapter.quote('X');
    await adapter.lotSize('HAL', '2026-10-27');
    await adapter.optionOi('HAL', '2026-10-27', 4800, 'CE');
    const allowed = new Set(['/data/history', '/data/quotes', '/data/options-chain-v3', '/sym_details/NSE_FO.csv']);
    for (const u of urls) expect(allowed.has(new URL(u).pathname), u).toBe(true);
  });
});
