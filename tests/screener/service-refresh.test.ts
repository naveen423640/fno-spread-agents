import { describe, expect, it } from 'vitest';

import { refreshCandles } from '../../lib/screener/service';
import { addDays } from '../../lib/screener/broker/types';
import type { Candle } from '../../lib/screener/types';
import { AFTER_CLOSE, DURING_SESSION, makeDeps, mockBroker, SMALL_UNIVERSE, spy } from '../support/screener-service';

const tickers = Object.keys(SMALL_UNIVERSE);
const histCalls = (s: ReturnType<typeof spy>) => s.calls.filter((c) => c.method === 'history');

describe('refreshCandles', () => {
  it('first load: fetches each symbol and the index for the requested number of years, and saves them', async () => {
    const { deps, store } = makeDeps();
    const broker = spy(mockBroker('2026-10-06').adapter);
    const result = await refreshCandles(deps, broker, 'fyers', tickers, 2);
    expect(result.loginRequired).toBe(false);
    expect(Object.keys(result.data)).toEqual(tickers);
    expect(result.bench?.length).toBeGreaterThan(300);
    expect(result.asOf).toBe('2026-10-06');
    expect(histCalls(broker)).toHaveLength(tickers.length + 1);
    expect(histCalls(broker)[0].args[1]).toEqual({ from: addDays('2026-10-06', -730), to: '2026-10-06' });
    expect((await store.getCandles('fyers', tickers[0]))?.lastDate).toBe('2026-10-06');
  });

  it('a second load on the same day makes no broker calls (refresh once per trading day)', async () => {
    const { deps } = makeDeps();
    const adapter = mockBroker('2026-10-06').adapter;
    await refreshCandles(deps, spy(adapter), 'fyers', tickers, 2);
    const again = spy(adapter);
    const result = await refreshCandles(deps, again, 'fyers', tickers, 2);
    expect(again.calls).toEqual([]);
    expect(Object.keys(result.data)).toEqual(tickers);
  });

  it('the next trading day fetches only a short overlapping range', async () => {
    const first = makeDeps();
    await refreshCandles(first.deps, spy(mockBroker('2026-10-06').adapter), 'fyers', tickers, 2);
    const nextDay = { ...first.deps, now: () => new Date('2026-10-07T11:00:00Z') };
    const broker = spy(mockBroker('2026-10-07', 4, 401).adapter);
    await refreshCandles(nextDay, broker, 'fyers', tickers, 2);
    expect(histCalls(broker)).toHaveLength(tickers.length + 1);
    expect(histCalls(broker)[0].args[1]).toEqual({ from: '2026-09-29', to: '2026-10-07' });
  });

  it('never keeps a candle for a session that is not finished', async () => {
    const { deps, store } = makeDeps({ now: () => DURING_SESSION });
    const broker = spy(mockBroker('2026-10-06').adapter); // data includes 2026-10-06, which is still open
    const result = await refreshCandles(deps, broker, 'fyers', tickers, 2);
    expect(result.asOf).toBe('2026-10-05');
    expect(result.data[tickers[0]].every((c) => c.date <= '2026-10-05')).toBe(true);
    expect((await store.getCandles('fyers', tickers[0]))?.lastDate).toBe('2026-10-05');
  });

  it('a cache that does not reach back far enough is refetched in full', async () => {
    const { deps, store } = makeDeps();
    const base = mockBroker('2026-10-06');
    const short: Candle[] = base.data[tickers[0]].slice(-100);
    await store.saveCandles('fyers', tickers[0], short);
    const broker = spy(base.adapter);
    await refreshCandles(deps, broker, 'fyers', [tickers[0]], 2);
    expect(histCalls(broker)[0].args[1]).toEqual({ from: addDays('2026-10-06', -730), to: '2026-10-06' });
  });

  it('a login failure stops the whole refresh at once, with no retry', async () => {
    const { deps } = makeDeps();
    const broker = spy(mockBroker('2026-10-06').adapter, { history: async () => ({ ok: false, code: 'LOGIN_REQUIRED', message: 'sign in again' }) });
    const result = await refreshCandles(deps, broker, 'fyers', tickers, 2);
    expect(result.loginRequired).toBe(true);
    expect(histCalls(broker)).toHaveLength(1);
  });

  it('a symbol that fails is skipped with a reason while the others load', async () => {
    const { deps } = makeDeps();
    const base = mockBroker('2026-10-06').adapter;
    const broker = spy(base, { history: async (symbol, range) => (symbol === 'NSE:ONGC-EQ' ? { ok: false, code: 'NOT_FOUND', message: 'no such symbol' } : base.history(symbol, range)) });
    const result = await refreshCandles(deps, broker, 'fyers', tickers, 2);
    expect(Object.keys(result.data)).not.toContain('ONGC');
    expect(result.skipped).toEqual([{ symbol: 'ONGC', reason: 'no such symbol' }]);
    expect(Object.keys(result.data)).toHaveLength(tickers.length - 1);
  });

  it('a failing symbol with a cache falls back to the cached candles and says so', async () => {
    const { deps, store } = makeDeps({ now: () => new Date('2026-10-07T11:00:00Z') });
    const base = mockBroker('2026-10-06');
    await store.saveCandles('fyers', 'ONGC', base.data.ONGC);
    const broker = spy(base.adapter, { history: async (symbol, range) => (symbol === 'NSE:ONGC-EQ' ? { ok: false, code: 'UPSTREAM', message: 'timeout' } : base.adapter.history(symbol, range)) });
    const result = await refreshCandles(deps, broker, 'fyers', ['ONGC'], 2);
    expect(result.data.ONGC.length).toBeGreaterThan(300);
    expect(result.skipped[0].reason).toContain('using cached data');
  });

  it('reports progress up to the total, and the benchmark is required', async () => {
    const { deps } = makeDeps();
    const seen: [number, number][] = [];
    await refreshCandles(deps, spy(mockBroker('2026-10-06').adapter), 'fyers', tickers, 2, (done, total) => seen.push([done, total]));
    expect(seen[seen.length - 1]).toEqual([tickers.length + 1, tickers.length + 1]);
    const noBench = spy(mockBroker('2026-10-06').adapter, { history: async (symbol, range) => (symbol === 'NSE:NIFTY50-INDEX' ? { ok: false, code: 'UPSTREAM', message: 'down' } : mockBroker('2026-10-06').adapter.history(symbol, range)) });
    const result = await refreshCandles(makeDeps().deps, noBench, 'fyers', tickers, 2);
    expect(result.bench).toBeNull();
  });

  it('synthetic data is not cached', async () => {
    const { deps, store } = makeDeps();
    await refreshCandles(deps, spy(mockBroker('2026-10-06').adapter), 'synthetic', tickers, 2);
    expect(await store.getCandles('synthetic', tickers[0])).toBeNull();
  });

  it('only ever asks the broker for history', async () => {
    const { deps } = makeDeps();
    const broker = spy(mockBroker('2026-10-06').adapter);
    await refreshCandles(deps, broker, 'fyers', tickers, 2);
    expect(new Set(broker.calls.map((c) => c.method))).toEqual(new Set(['history']));
  });
});

describe('clock', () => {
  it('the fixed test clocks fall where the tests assume', () => {
    expect(AFTER_CLOSE.toISOString()).toBe('2026-10-06T11:00:00.000Z');
    expect(DURING_SESSION.toISOString()).toBe('2026-10-06T05:30:00.000Z');
  });
});
