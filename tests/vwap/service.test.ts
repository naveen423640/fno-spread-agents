import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { C5 } from '@/lib/vwap/core';
import { chunkDays, createFyersProvider, createRateLimiter, firstWithData, type DataProvider, type ProviderResult } from '@/lib/vwap/provider';
import { LoginRequiredError, resolveScanDate, scanOne, scanUniverse } from '@/lib/vwap/service';
import { createVwapStore } from '@/lib/vwap/store';
import { loadNifty500, loadUniverse, parseNifty500Csv, toFyersSymbol } from '@/lib/vwap/universe';
import { createD1Fake } from '../support/d1-fake';

type Fixture = { days: Record<string, number[][]> };
const fixture = (name: string): Fixture => JSON.parse(readFileSync(`tests/fixtures/vwap/${name}.json`, 'utf8')) as Fixture;
const toC5 = (rows: number[][]): C5[] => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

// A provider that serves the real fixtures and records every request, so the tests can see exactly what a scan fetched.
function fixtureProvider(names: Record<string, string>, extra?: (symbol: string, from: string, to: string) => ProviderResult<C5[]> | null) {
  const calls: { symbol: string; from: string; to: string }[] = [];
  const provider: DataProvider = {
    name: 'fixture',
    async candles5m(symbol, from, to) {
      calls.push({ symbol, from, to });
      const override = extra?.(symbol, from, to);
      if (override) return override;
      const f = names[symbol] ? fixture(names[symbol]) : null;
      if (!f) return { ok: false, code: 'UPSTREAM', message: 'unknown symbol' };
      return { ok: true, value: Object.entries(f.days).filter(([d]) => d >= from && d <= to).flatMap(([, rows]) => toC5(rows)) };
    },
  };
  return { provider, calls };
}
const SYMBOLS = { 'NSE:TCS-EQ': 'tcs', 'NSE:OFSS-EQ': 'ofss', 'NSE:LTM-EQ': 'ltm' };
const entry = (ticker: string) => ({ ticker, symbol: `NSE:${ticker}-EQ`, name: ticker, sector: 'Information Technology' });
const fresh = () => createVwapStore(createD1Fake(['drizzle/0006_vwap.sql']));

describe('scanOne: cold and warm', () => {
  it('a cold scan fetches the month to date once and matches the golden numbers', async () => {
    const { provider, calls } = fixtureProvider(SYMBOLS);
    const result = await scanOne({ provider, store: fresh(), entry: entry('LTM'), day: '2026-10-07' });
    expect(calls).toEqual([{ symbol: 'NSE:LTM-EQ', from: '2026-10-01', to: '2026-10-07' }]);
    expect(result.status).toBe('ok');
    expect(result.scan!.events.map((e) => `${e.time} ${e.direction}`)).toEqual(['10:15 up', '10:20 down', '10:45 up', '11:00 down']);
    expect(result.sessionsInMonth).toBe(3); // 1, 5 and 6 October
  });

  it('a warm scan on the same day fetches only that day', async () => {
    const { provider, calls } = fixtureProvider(SYMBOLS);
    const store = fresh();
    await scanOne({ provider, store, entry: entry('TCS'), day: '2026-10-07' });
    calls.length = 0;
    const again = await scanOne({ provider, store, entry: entry('TCS'), day: '2026-10-07' });
    expect(calls).toEqual([{ symbol: 'NSE:TCS-EQ', from: '2026-10-07', to: '2026-10-07' }]);
    expect(again.scan!.events.find((e) => e.time === '10:40')?.direction).toBe('up');
  });

  it('the next day fetches the previous day and the new day, not the whole month', async () => {
    const { provider, calls } = fixtureProvider(SYMBOLS);
    const store = fresh();
    await scanOne({ provider, store, entry: entry('TCS'), day: '2026-10-07' });
    calls.length = 0;
    const next = await scanOne({ provider, store, entry: entry('TCS'), day: '2026-10-08' });
    expect(calls).toEqual([{ symbol: 'NSE:TCS-EQ', from: '2026-10-07', to: '2026-10-08' }]);
    expect(next.sessionsInMonth).toBe(4);
  });

  it('gives the same answer cold, warm and after a gap of several days', async () => {
    const { provider } = fixtureProvider(SYMBOLS);
    const cold = await scanOne({ provider, store: fresh(), entry: entry('OFSS'), day: '2026-10-09' });
    const store = fresh();
    await scanOne({ provider, store, entry: entry('OFSS'), day: '2026-10-05' });
    const caught = await scanOne({ provider, store, entry: entry('OFSS'), day: '2026-10-09' }); // skipped 6, 7 and 8 October
    expect(caught.scan!.vwap).toBeCloseTo(cold.scan!.vwap!, 10);
    expect(caught.scan!.events).toEqual(cold.scan!.events);
  });

  it('does not refetch a holiday: days with no candles are remembered as checked', async () => {
    const { provider, calls } = fixtureProvider(SYMBOLS);
    const store = fresh();
    await scanOne({ provider, store, entry: entry('TCS'), day: '2026-10-05' }); // 2 October was a holiday
    calls.length = 0;
    await scanOne({ provider, store, entry: entry('TCS'), day: '2026-10-06' });
    expect(calls).toEqual([{ symbol: 'NSE:TCS-EQ', from: '2026-10-05', to: '2026-10-06' }]);
  });

  it('a new month starts from empty totals', async () => {
    const { provider, calls } = fixtureProvider(SYMBOLS, (_s, from) => (from.startsWith('2026-11') ? { ok: true, value: [] } : null));
    const store = fresh();
    await scanOne({ provider, store, entry: entry('TCS'), day: '2026-10-07' });
    calls.length = 0;
    const november = await scanOne({ provider, store, entry: entry('TCS'), day: '2026-11-02' });
    expect(calls[0].from).toBe('2026-11-01');
    expect(november.status).toBe('no-session');
    expect(november.sessionsInMonth).toBe(0);
  });

  it('reports a day with no candles as no-session instead of failing', async () => {
    const { provider } = fixtureProvider(SYMBOLS);
    const r = await scanOne({ provider, store: fresh(), entry: entry('TCS'), day: '2026-10-03' }); // a Saturday
    expect(r.status).toBe('no-session');
  });

  it('excludes a forming candle when given a clock', async () => {
    const { provider } = fixtureProvider(SYMBOLS);
    const during = Date.parse('2026-10-07T10:42:00+05:30') / 1000;
    const r = await scanOne({ provider, store: fresh(), entry: entry('TCS'), day: '2026-10-07', nowSeconds: during });
    expect(r.scan!.formingExcluded).toBe(true);
    expect(r.scan!.events.some((e) => e.time === '10:40')).toBe(false); // the 10:40 candle closes at 10:45
  });
});

describe('scanOne: failures and data quality', () => {
  it('turns a provider error into an error row and saves nothing', async () => {
    const { provider } = fixtureProvider({}, () => ({ ok: false, code: 'UPSTREAM', message: 'FYERS returned 500' }));
    const r = await scanOne({ provider, store: fresh(), entry: entry('TCS'), day: '2026-10-07' });
    expect(r).toMatchObject({ status: 'error', error: 'FYERS returned 500' });
  });

  it('throws LoginRequiredError so the whole run can stop with a clear message', async () => {
    const { provider } = fixtureProvider({}, () => ({ ok: false, code: 'LOGIN_REQUIRED', message: 'The FYERS login has expired. Sign in again.' }));
    await expect(scanOne({ provider, store: fresh(), entry: entry('TCS'), day: '2026-10-07' })).rejects.toBeInstanceOf(LoginRequiredError);
  });

  it('flags the VWAP unreliable after a large one-day gap with no volume spike (possible split)', async () => {
    const T = (day: string, i: number) => Date.parse(`${day}T09:15:00+05:30`) / 1000 + i * 300;
    const mk = (day: string, price: number, v: number): C5[] => Array.from({ length: 5 }, (_, i) => ({ t: T(day, i), o: price, h: price, l: price, c: price, v }));
    const candles = [...mk('2026-10-01', 1000, 1000), ...mk('2026-10-05', 1000, 1000), ...mk('2026-10-06', 500, 1000), ...mk('2026-10-07', 500, 1000)];
    const provider: DataProvider = { name: 'fake', candles5m: async (_s, from, to) => ({ ok: true, value: candles.filter((c) => { const d = new Date((c.t + 19800) * 1000).toISOString().slice(0, 10); return d >= from && d <= to; }) }) };
    const r = await scanOne({ provider, store: fresh(), entry: entry('SPLIT'), day: '2026-10-07' });
    expect(r.unreliable).toBe(true);
    expect(r.unreliableNote).toMatch(/50% gap|-50% gap/);
  });

  it('does not flag a big gap that comes with a volume spike (earnings)', async () => {
    const T = (day: string, i: number) => Date.parse(`${day}T09:15:00+05:30`) / 1000 + i * 300;
    const mk = (day: string, price: number, v: number): C5[] => Array.from({ length: 5 }, (_, i) => ({ t: T(day, i), o: price, h: price, l: price, c: price, v }));
    const candles = [...mk('2026-10-01', 1000, 1000), ...mk('2026-10-05', 1000, 1000), ...mk('2026-10-06', 700, 9000), ...mk('2026-10-07', 700, 1000)];
    const provider: DataProvider = { name: 'fake', candles5m: async (_s, from, to) => ({ ok: true, value: candles.filter((c) => { const d = new Date((c.t + 19800) * 1000).toISOString().slice(0, 10); return d >= from && d <= to; }) }) };
    expect((await scanOne({ provider, store: fresh(), entry: entry('EARN'), day: '2026-10-07' })).unreliable).toBe(false);
  });
});

describe('scanUniverse', () => {
  it('scans several symbols, keeps one bad symbol from stopping the rest, and reports progress', async () => {
    const { provider } = fixtureProvider(SYMBOLS);
    const progress: number[] = [];
    const out = await scanUniverse({ provider, store: fresh(), entries: [entry('TCS'), entry('NOPE'), entry('OFSS'), entry('LTM')], day: '2026-10-07', concurrency: 2, onProgress: (d) => progress.push(d) });
    expect(out.results.map((r) => r.status).sort()).toEqual(['error', 'ok', 'ok', 'ok']);
    expect(out.loginRequired).toBe(false);
    expect(progress.length).toBe(4);
  });

  it('stops launching work once the login is found to be expired', async () => {
    let calls = 0;
    const provider: DataProvider = { name: 'fake', candles5m: async () => { calls += 1; return { ok: false, code: 'LOGIN_REQUIRED', message: 'expired' }; } };
    const entries = Array.from({ length: 30 }, (_, i) => entry(`S${i}`));
    const out = await scanUniverse({ provider, store: fresh(), entries, day: '2026-10-07', concurrency: 3 });
    expect(out.loginRequired).toBe(true);
    expect(calls).toBeLessThan(30);
    expect(out.skipped).toBeGreaterThan(0);
  });
});

describe('firstWithData', () => {
  const has = (name: string, n: number): DataProvider => ({ name, candles5m: async () => ({ ok: true as const, value: Array.from({ length: n }, (_, i) => ({ t: i, o: 1, h: 1, l: 1, c: 1, v: 1 })) }) });
  it('uses the first provider that has candles and skips empty ones', async () => {
    const r = await firstWithData([has('a', 0), has('b', 3), has('c', 5)]).candles5m('X', '2026-10-01', '2026-10-02');
    expect(r.ok && r.value).toHaveLength(3);
  });
  it('returns empty (not an error) when none has data, and an error only if the last one failed', async () => {
    expect(await firstWithData([has('a', 0), has('b', 0)]).candles5m('X', 'a', 'b')).toEqual({ ok: true, value: [] });
    const bad: DataProvider = { name: 'bad', candles5m: async () => ({ ok: false, code: 'UPSTREAM', message: 'down' }) };
    expect(await firstWithData([has('a', 0), bad]).candles5m('X', 'a', 'b')).toMatchObject({ ok: false });
  });
});

describe('resolveScanDate', () => {
  it('uses today during and after the session, and the last session otherwise', () => {
    expect(resolveScanDate('2026-10-07', new Date())).toBe('2026-10-07');
    expect(resolveScanDate('today', new Date('2026-10-12T06:00:00Z'))).toBe('2026-10-12'); // Monday 11:30 IST
    expect(resolveScanDate('today', new Date('2026-10-12T02:00:00Z'))).toBe('2026-10-09'); // Monday 07:30 IST, before the open
    expect(resolveScanDate('today', new Date('2026-10-11T06:00:00Z'))).toBe('2026-10-09'); // Sunday
  });
});

describe('FyersProvider', () => {
  const credentials = { clientId: 'c', accessToken: 't' };
  const instant = async () => {};
  const okBody = (rows: number[][]) => new Response(JSON.stringify({ s: 'ok', candles: rows }), { status: 200 });

  it('splits a long range into requests of at most 100 days', () => {
    expect(chunkDays('2026-01-01', '2026-01-31')).toEqual([{ from: '2026-01-01', to: '2026-01-31' }]);
    const chunks = chunkDays('2026-01-01', '2026-06-30');
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toEqual({ from: '2026-01-01', to: '2026-04-10' });
    expect(chunks[1].from).toBe('2026-04-11');
    expect(chunks[1].to).toBe('2026-06-30');
  });

  it('retries a 429 with backoff and then succeeds', async () => {
    let n = 0;
    const fetchImpl = (async () => (++n === 1 ? new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }) : okBody([[1791344700, 1, 2, 0.5, 1.5, 10]]))) as unknown as typeof fetch;
    const waits: number[] = [];
    const provider = createFyersProvider({ credentials, fetchImpl, sleep: async (ms) => { waits.push(ms); }, limiter: instant });
    const r = await provider.candles5m('NSE:TCS-EQ', '2026-10-07', '2026-10-07');
    expect(r.ok && r.value).toHaveLength(1);
    expect(n).toBe(2);
    expect(waits[0]).toBeGreaterThanOrEqual(1000);
  });

  it('gives up after repeated failures with a plain message', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    const provider = createFyersProvider({ credentials, fetchImpl, sleep: instant, limiter: instant, maxAttempts: 3 });
    expect(await provider.candles5m('NSE:TCS-EQ', '2026-10-07', '2026-10-07')).toMatchObject({ ok: false, code: 'UPSTREAM', message: 'FYERS returned 503' });
  });

  it('reports an expired token as LOGIN_REQUIRED without retrying', async () => {
    let n = 0;
    const fetchImpl = (async () => { n += 1; return new Response('{"s":"error","code":-16,"message":"token expired"}', { status: 200 }); }) as unknown as typeof fetch;
    const provider = createFyersProvider({ credentials, fetchImpl, sleep: instant, limiter: instant });
    expect(await provider.candles5m('NSE:TCS-EQ', '2026-10-07', '2026-10-07')).toMatchObject({ ok: false, code: 'LOGIN_REQUIRED' });
    expect(n).toBe(1);
  });

  it('treats an empty or no_data answer as a range with no sessions, not an error', async () => {
    const fetchImpl = (async () => new Response('{"s":"no_data"}', { status: 200 })) as unknown as typeof fetch;
    const provider = createFyersProvider({ credentials, fetchImpl, sleep: instant, limiter: instant });
    expect(await provider.candles5m('NSE:TCS-EQ', '2026-10-03', '2026-10-04')).toEqual({ ok: true, value: [] });
  });

  it('never puts the token in an error message', async () => {
    const fetchImpl = (async () => { throw new Error('boom t'); }) as unknown as typeof fetch;
    const provider = createFyersProvider({ credentials: { clientId: 'c', accessToken: 'SECRET-TOKEN' }, fetchImpl, sleep: instant, limiter: instant, maxAttempts: 2 });
    const r = await provider.candles5m('NSE:TCS-EQ', '2026-10-07', '2026-10-07');
    expect(JSON.stringify(r)).not.toContain('SECRET-TOKEN');
  });

  it('the rate limiter spaces calls by the configured gap', async () => {
    let clock = 0;
    const waits: number[] = [];
    const limit = createRateLimiter(10, () => clock, async (ms) => { waits.push(ms); clock += ms; });
    await limit(); await limit(); await limit();
    expect(waits).toEqual([100, 100]);
  });
});

describe('universes', () => {
  const csv = 'Company Name,Industry,Symbol,Series,ISIN Code\r\nLTM Ltd.,Information Technology,LTM,EQ,INE214T01019\r\n"Foo, Bar Ltd.",Capital Goods,FOO,EQ,INE000000001\r\nOld Co,Financial Services,OLD,BE,INE000000002\r\nLTIMindtree,Information Technology,LTIM,EQ,INE000000003\r\n';
  it('parses the NSE list, keeps EQ series only, handles quoted commas and maps renamed tickers', () => {
    const rows = parseNifty500Csv(csv);
    expect(rows.map((r) => r.ticker)).toEqual(['LTM', 'FOO', 'LTM']); // LTIM becomes LTM
    expect(rows[1]).toMatchObject({ name: 'Foo, Bar Ltd.', sector: 'Capital Goods', symbol: 'NSE:FOO-EQ' });
  });
  it('maps a ticker to the FYERS symbol, including renamed ones', () => {
    expect(toFyersSymbol('LTIM')).toBe('NSE:LTM-EQ');
    expect(toFyersSymbol('M&M')).toBe('NSE:M&M-EQ');
  });
  it('loads the fixed Nifty IT list, an F&O sector, and custom tickers', async () => {
    const deps = { today: '2026-10-07' };
    expect((await loadUniverse('nifty_it', deps)).map((e) => e.ticker)).toEqual(['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'LTM', 'PERSISTENT', 'COFORGE', 'MPHASIS', 'OFSS']);
    expect((await loadUniverse('sector:banks', deps)).every((e) => e.sector === 'Banks')).toBe(true);
    expect((await loadUniverse('custom:tcs, infy,LTIM', deps)).map((e) => e.symbol)).toEqual(['NSE:TCS-EQ', 'NSE:INFY-EQ', 'NSE:LTM-EQ']);
    await expect(loadUniverse('sector:nonsense', deps)).rejects.toThrow(/Unknown sector/);
    await expect(loadUniverse('whatever', deps)).rejects.toThrow(/Unknown universe/);
  });
  it('caches the Nifty 500 for the month and falls back to the cache when NSE is unreachable', async () => {
    const store = fresh();
    const bigCsv = 'Company Name,Industry,Symbol,Series,ISIN Code\n' + Array.from({ length: 450 }, (_, i) => `Co ${i},Industry,SYM${i},EQ,INE${i}`).join('\n');
    let fetches = 0;
    const fetchImpl = (async () => { fetches += 1; return new Response(bigCsv, { status: 200 }); }) as unknown as typeof fetch;
    const first = await loadNifty500({ store, fetchImpl, today: '2026-10-07' });
    expect(first).toHaveLength(450);
    await loadNifty500({ store, fetchImpl, today: '2026-10-20' });
    expect(fetches).toBe(1); // same month: served from the cache
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await loadNifty500({ store, fetchImpl: down, today: '2026-11-03' })).toHaveLength(450); // new month, NSE down: old list
    await expect(loadNifty500({ store: fresh(), fetchImpl: down, today: '2026-11-03' })).rejects.toThrow(/Could not load the Nifty 500/);
  });
});
