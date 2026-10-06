import { describe, expect, it } from 'vitest';

import { createKiteAdapter } from '../../lib/screener/broker/kite';

// Kite has no verified live access in this project: these tests use mocked responses shaped like the documented API.
const credentials = { apiKey: 'KEY123', accessToken: 'kite-SECRET-tok' };
const HEADER = 'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange';
const NSE = [HEADER, '738561,2885,RELIANCE,RELIANCE INDUSTRIES,0,,0,0.05,1,EQ,NSE,NSE', '256265,1001,NIFTY 50,NIFTY 50,0,,0,0,1,EQ,INDICES,NSE', '9999,10,M&M,MAHINDRA & MAHINDRA,0,,0,0.05,1,EQ,NSE,NSE'].join('\n');
const NFO = [HEADER, '1,1,HAL26OCT4800CE,HAL,0,2026-10-27,4800,0.05,150,CE,NFO-OPT,NFO', '2,2,HAL26NOVFUT,HAL,0,2026-11-24,0,0.05,150,FUT,NFO-FUT,NFO', '3,3,RELIANCE26OCT1200PE,RELIANCE,0,2026-10-27,1200,0.05,500,PE,NFO-OPT,NFO'].join('\n');

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
  return { adapter: createKiteAdapter({ credentials, fetchImpl, sleep: async (ms) => { sleeps.push(ms); } }), urls, headers, sleeps };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const route: Handler = (url) => {
  if (url.pathname === '/instruments/NSE') return new Response(NSE);
  if (url.pathname === '/instruments/NFO') return new Response(NFO);
  if (url.pathname.startsWith('/instruments/historical/738561/day')) return json({ status: 'success', data: { candles: [['2026-09-30T00:00:00+0530', 99, 102, 98, 100, 1000], ['2026-10-01T00:00:00+0530', 105, 108, 104, 106, 1100]] } });
  if (url.pathname === '/quote') return json({ status: 'success', data: { 'NFO:HAL26OCT4800CE': { last_price: 119, oi: 5500, depth: { buy: [{ price: 118.5 }], sell: [{ price: 120 }] } } } });
  return json({ status: 'error', message: 'not routed' }, 404);
};

describe('symbols', () => {
  it('builds the Kite formats', () => {
    const { adapter } = setup(route);
    expect(adapter.name).toBe('kite');
    expect(adapter.equitySymbol('RELIANCE')).toBe('NSE:RELIANCE');
    expect(adapter.indexSymbol()).toBe('NSE:NIFTY 50');
    expect(adapter.optionSymbol('APOLLOHOSP', '2026-10-27', 8000, 'CE')).toBe('NFO:APOLLOHOSP26OCT8000CE');
  });
});

describe('history', () => {
  it('maps the symbol to its instrument token, calls the day endpoint with the auth header and parses candles', async () => {
    const { adapter, urls, headers } = setup(route);
    const result = await adapter.history('NSE:RELIANCE', { from: '2026-09-01', to: '2026-10-01' });
    expect(result).toEqual({ ok: true, value: [
      { date: '2026-09-30', open: 99, high: 102, low: 98, close: 100, volume: 1000 },
      { date: '2026-10-01', open: 105, high: 108, low: 104, close: 106, volume: 1100 },
    ] });
    const call = urls.find((u) => u.includes('/instruments/historical/'))!;
    expect(new URL(call).searchParams.get('from')).toBe('2026-09-01');
    expect(new URL(call).searchParams.get('to')).toBe('2026-10-01');
    expect(headers[0].Authorization).toBe('token KEY123:kite-SECRET-tok');
    expect(headers[0]['X-Kite-Version']).toBe('3');
    expect(urls.join(' ')).not.toContain('kite-SECRET-tok');
  });

  it('resolves the index and symbols with special characters', async () => {
    const { adapter, urls } = setup((url) => (url.pathname.startsWith('/instruments/historical/') ? json({ status: 'success', data: { candles: [['2026-10-01T00:00:00+0530', 1, 2, 0.5, 1.5, 10]] } }) : route(url, {})));
    expect((await adapter.history('NSE:NIFTY 50', { from: '2026-09-01', to: '2026-10-01' })).ok).toBe(true);
    expect((await adapter.history('NSE:M&M', { from: '2026-09-01', to: '2026-10-01' })).ok).toBe(true);
    expect(urls.some((u) => u.includes('/instruments/historical/256265/day'))).toBe(true);
    expect(urls.some((u) => u.includes('/instruments/historical/9999/day'))).toBe(true);
  });

  it('an unknown symbol is NOT_FOUND', async () => {
    const { adapter } = setup(route);
    expect(await adapter.history('NSE:NOSUCH', { from: '2026-09-01', to: '2026-10-01' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('a token error (HTTP 403 TokenException) is LOGIN_REQUIRED with no retry', async () => {
    const { adapter, urls } = setup((url) => (url.pathname.startsWith('/instruments/historical/') ? json({ status: 'error', error_type: 'TokenException', message: 'Incorrect api_key or access_token' }, 403) : route(url, {})));
    expect(await adapter.history('NSE:RELIANCE', { from: '2026-09-01', to: '2026-10-01' })).toMatchObject({ ok: false, code: 'LOGIN_REQUIRED' });
    expect(urls.filter((u) => u.includes('/historical/'))).toHaveLength(1);
  });

  it('chunks ranges longer than 2000 days and throttles between requests', async () => {
    const { adapter, urls, sleeps } = setup(route);
    await adapter.history('NSE:RELIANCE', { from: '2018-01-01', to: '2026-10-01' });
    expect(urls.filter((u) => u.includes('/historical/')).length).toBe(2);
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
  });

  it('a network error is UPSTREAM with fixed text', async () => {
    const { adapter } = setup(() => { throw new Error('boom kite-SECRET-tok'); });
    const result = await adapter.history('NSE:RELIANCE', { from: '2026-09-01', to: '2026-10-01' });
    expect(result).toMatchObject({ ok: false, code: 'UPSTREAM' });
    expect(JSON.stringify(result)).not.toContain('kite-SECRET-tok');
  });
});

describe('quote', () => {
  it('reads best bid and ask from the depth, and last price and OI', async () => {
    const { adapter, urls } = setup(route);
    expect(await adapter.quote('NFO:HAL26OCT4800CE')).toEqual({ ok: true, value: { bid: 118.5, ask: 120, ltp: 119, oi: 5500 } });
    expect(new URL(urls[0]).searchParams.get('i')).toBe('NFO:HAL26OCT4800CE');
  });

  it('empty depth gives null bid and ask; an absent symbol is NOT_FOUND', async () => {
    const empty = setup(() => json({ status: 'success', data: { X: { last_price: 5, oi: 0, depth: { buy: [], sell: [] } } } }));
    expect(await empty.adapter.quote('X')).toEqual({ ok: true, value: { bid: null, ask: null, ltp: 5, oi: 0 } });
    const none = setup(() => json({ status: 'success', data: {} }));
    expect(await none.adapter.quote('Y')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('lotSize (NFO instruments dump)', () => {
  it('finds the lot for an underlying and expiry and downloads the dump once', async () => {
    const { adapter, urls } = setup(route);
    expect(await adapter.lotSize('HAL', '2026-10-27')).toEqual({ ok: true, value: 150 });
    expect(await adapter.lotSize('RELIANCE', '2026-10-27')).toEqual({ ok: true, value: 500 });
    expect(urls.filter((u) => u.endsWith('/instruments/NFO'))).toHaveLength(1);
    expect(await adapter.lotSize('HAL', '2026-12-29')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('optionOi', () => {
  it('reads OI from the option quote', async () => {
    const { adapter } = setup(route);
    expect(await adapter.optionOi('HAL', '2026-10-27', 4800, 'CE')).toEqual({ ok: true, value: 5500 });
  });
});

describe('read-only', () => {
  it('only ever requests instrument dumps, historical candles and quotes', async () => {
    const { adapter, urls } = setup(route);
    await adapter.history('NSE:RELIANCE', { from: '2026-09-01', to: '2026-10-01' });
    await adapter.quote('NFO:HAL26OCT4800CE');
    await adapter.lotSize('HAL', '2026-10-27');
    for (const u of urls) expect(/^\/(instruments\/(NSE|NFO)|instruments\/historical\/\d+\/day|quote)$/.test(new URL(u).pathname), u).toBe(true);
  });
});
