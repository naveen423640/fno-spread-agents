import { describe, expect, it } from 'vitest';

import { UNIVERSE } from '../../lib/screener/config';
import { candidateDetail, runScreenerCheck, startScreenerJob } from '../../lib/screener/service';
import type { ScanRow } from '../../lib/screener/types';
import { makeDeps, mockBroker, SMALL_UNIVERSE, spy } from '../support/screener-service';

const SIX = Object.fromEntries(Object.entries(UNIVERSE).slice(0, 6));
const synthetic = { stocks: 6, days: 700, seed: 3 };

describe('startScreenerJob: validation and limits', () => {
  it.each([
    ['unknown kind', { kind: 'trade', source: 'synthetic' }],
    ['unknown source', { kind: 'scan', source: 'yahoo' }],
    ['missing fields', {}],
    ['bad parameters', { kind: 'scan', source: 'synthetic', params: { holdDays: 3 } }],
    ['unknown parameter', { kind: 'scan', source: 'synthetic', params: { rsiBul: [30, 40] } }],
  ])('rejects %s with 400 and creates no job', async (_label, request) => {
    const { deps, store } = makeDeps({ universe: SIX, synthetic });
    expect(await startScreenerJob(deps, request)).toMatchObject({ status: 400 });
    expect(await store.getJob('job-1')).toBeNull();
  });

  it('a live source with no broker connection is 401 (re-login), not a started job', async () => {
    const { deps, store } = makeDeps({ brokerFor: () => null });
    const result = await startScreenerJob(deps, { kind: 'scan', source: 'fyers' });
    expect(result).toMatchObject({ status: 401 });
    expect(await store.getJob('job-1')).toBeNull();
  });

  it('stops at the daily job cap with 429', async () => {
    const { deps, settle } = makeDeps({ universe: SIX, synthetic, maxJobsPerDay: 1 });
    expect(await startScreenerJob(deps, { kind: 'scan', source: 'synthetic' })).toEqual({ jobId: 'job-1' });
    await settle();
    expect(await startScreenerJob(deps, { kind: 'scan', source: 'synthetic' })).toMatchObject({ status: 429 });
  });

  it('returns before the work finishes, with the job already visible as running', async () => {
    const { deps, store, settle } = makeDeps({ universe: SIX, synthetic });
    const result = await startScreenerJob(deps, { kind: 'scan', source: 'synthetic' });
    expect(result).toEqual({ jobId: 'job-1' });
    expect((await store.getJob('job-1'))?.status).toBe('running');
    await settle();
    expect((await store.getJob('job-1'))?.status).toBe('done');
  });
});

describe('scan job (synthetic source)', () => {
  it('finishes with rows, the as-of date, the monthly expiry and a lot size on every row', async () => {
    const { deps, store, settle } = makeDeps({ universe: SIX, synthetic });
    await startScreenerJob(deps, { kind: 'scan', source: 'synthetic' });
    await settle();
    const job = await store.getJob('job-1');
    expect(job).toMatchObject({ status: 'done', progress: 100, kind: 'scan', source: 'synthetic' });
    const result = job?.result as { asOf: string; expiry: string; rows: ScanRow[]; counts: { symbols: number }; params: { holdDays: number } };
    expect(result.asOf).toBe('2026-10-06');
    expect(result.expiry).toBe('2026-10-27');
    expect(result.counts.symbols).toBe(6);
    expect(result.params.holdDays).toBe(20);
    expect(result.rows.every((row) => row.expiry === '2026-10-27' && row.lotSize === 100)).toBe(true);
  });

  it('stores the parameters it was run with', async () => {
    const { deps, store, settle } = makeDeps({ universe: SIX, synthetic });
    await startScreenerJob(deps, { kind: 'scan', source: 'synthetic', params: { holdDays: 25 } });
    await settle();
    const job = await store.getJob('job-1');
    expect((job as { params: { holdDays: number } }).params.holdDays).toBe(25);
  });
});

describe('backtest job (synthetic source)', () => {
  it('finishes with the six variants, trade counts, half-period stats and the under-100 flag', async () => {
    const { deps, store, settle } = makeDeps({ universe: SIX, synthetic });
    await startScreenerJob(deps, { kind: 'backtest', source: 'synthetic' });
    await settle();
    const job = await store.getJob('job-1');
    expect(job).toMatchObject({ status: 'done', progress: 100, kind: 'backtest' });
    const result = job?.result as { variants: { name: string; stats: { n: number }; tradeCount: number; lowSample: boolean }[]; banner: string; minTrades: number };
    expect(result.variants.map((v) => v.name)).toEqual(['bull_full', 'bull_no_trigger', 'oversold_only (RSI<30)', 'oversold_in_uptrend', 'uptrend_baseline', 'bear_full']);
    for (const variant of result.variants) {
      expect(variant.tradeCount).toBe(variant.stats.n);
      expect(variant.lowSample).toBe(variant.tradeCount < 100);
    }
    expect(result.minTrades).toBe(100);
    expect(result.banner).toMatch(/Black-Scholes/);
    expect(result.banner).toMatch(/indicative only/);
  });
});

describe('live source behaviour', () => {
  it('a login failure ends the job as login_required after a single call, with no retry', async () => {
    const broker = spy(mockBroker('2026-10-06').adapter, { history: async () => ({ ok: false, code: 'LOGIN_REQUIRED', message: 'sign in again' }) });
    const { deps, store, settle } = makeDeps({ brokerFor: () => broker });
    await startScreenerJob(deps, { kind: 'scan', source: 'fyers' });
    await settle();
    expect(await store.getJob('job-1')).toMatchObject({ status: 'login_required' });
    expect((await store.getJob('job-1'))?.message).toMatch(/sign in/i);
    expect(broker.calls.filter((c) => c.method === 'history')).toHaveLength(1);
  });

  it('a lot-size failure leaves the lot as null rather than failing the scan', async () => {
    const base = mockBroker('2026-10-06', 6, 700, 3);
    const broker = spy(base.adapter, { lotSize: async () => ({ ok: false, code: 'NOT_FOUND', message: 'no contract' }) });
    const { deps, store, settle } = makeDeps({ universe: SIX, brokerFor: () => broker });
    await startScreenerJob(deps, { kind: 'scan', source: 'fyers' });
    await settle();
    const job = await store.getJob('job-1');
    expect(job?.status).toBe('done');
    expect((job as { result: { rows: ScanRow[] } }).result.rows.every((row) => row.lotSize === null)).toBe(true);
  });

  it('a crash ends the job as failed with a message', async () => {
    const broker = spy(mockBroker('2026-10-06').adapter, { history: async () => { throw new Error('boom'); } });
    const { deps, store, settle } = makeDeps({ brokerFor: () => broker });
    await startScreenerJob(deps, { kind: 'scan', source: 'fyers' });
    await settle();
    expect(await store.getJob('job-1')).toMatchObject({ status: 'failed' });
    expect((await store.getJob('job-1'))?.message).toContain('boom');
  });

  it('a missing benchmark fails the job with a clear message', async () => {
    const base = mockBroker('2026-10-06').adapter;
    const broker = spy(base, { history: async (symbol, range) => (symbol === 'NSE:NIFTY50-INDEX' ? { ok: false, code: 'UPSTREAM', message: 'down' } : base.history(symbol, range)) });
    const { deps, store, settle } = makeDeps({ brokerFor: () => broker });
    await startScreenerJob(deps, { kind: 'scan', source: 'fyers' });
    await settle();
    expect(await store.getJob('job-1')).toMatchObject({ status: 'failed' });
    expect((await store.getJob('job-1'))?.message).toMatch(/benchmark|index/i);
  });

  it('the job only ever reads: history, lot size and nothing else', async () => {
    const broker = spy(mockBroker('2026-10-06', 4, 400).adapter);
    const { deps, settle } = makeDeps({ brokerFor: () => broker });
    await startScreenerJob(deps, { kind: 'scan', source: 'fyers' });
    await settle();
    expect([...new Set(broker.calls.map((c) => c.method))].every((m) => ['history', 'lotSize'].includes(m))).toBe(true);
  });
});

describe('runScreenerCheck (live option check)', () => {
  const base = () => mockBroker('2026-10-06', 4, 400, 3);
  const lastClose = (b: ReturnType<typeof base>) => b.data.RELIANCE[b.data.RELIANCE.length - 1].close;
  const request = (b: ReturnType<typeof base>, over: Record<string, unknown> = {}) => ({ source: 'fyers', symbol: 'RELIANCE', side: 'bull', kLong: Math.round(lastClose(b)), kShort: Math.round(lastClose(b) * 1.08), expiry: '2026-10-27', ...over });

  it('prices both legs, finds the lot and returns the spread maths', async () => {
    const b = base();
    const { deps } = makeDeps({ brokerFor: () => b.adapter });
    const result = await runScreenerCheck(deps, request(b));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lot).toBe(100);
    expect(result.longSymbol).toMatch(/^NSE:RELIANCE26OCT\d+CE$/);
    expect(result.shortSymbol).toMatch(/^NSE:RELIANCE26OCT\d+CE$/);
    expect(result.check.debit).toBeGreaterThan(0);
    expect(result.check.maxLossRs).toBeCloseTo(result.check.debit * 100, 6);
    expect(result.check.long.oi).toBe(10_000);
  });

  it('fills a missing OI from the option chain lookup', async () => {
    const b = base();
    const broker = spy(b.adapter, { optionOi: async () => ({ ok: true, value: 777 }), quote: async (symbol) => { const q = await b.adapter.quote(symbol); return q.ok ? { ok: true, value: { ...q.value, oi: null } } : q; } });
    const { deps } = makeDeps({ brokerFor: () => broker });
    const result = await runScreenerCheck(deps, request(b));
    expect(result.ok && result.check.long.oi).toBe(777);
  });

  it('passes broker failures through: login required and unknown contract', async () => {
    const b = base();
    const login = makeDeps({ brokerFor: () => spy(b.adapter, { quote: async () => ({ ok: false, code: 'LOGIN_REQUIRED', message: 'sign in' }) }) });
    expect(await runScreenerCheck(login.deps, request(b))).toMatchObject({ ok: false, code: 'LOGIN_REQUIRED' });
    const missing = makeDeps({ brokerFor: () => spy(b.adapter, { quote: async () => ({ ok: false, code: 'NOT_FOUND', message: 'no such strike' }) }) });
    expect(await runScreenerCheck(missing.deps, request(b))).toMatchObject({ ok: false, code: 'NOT_FOUND', message: 'no such strike' });
  });

  it('refuses a missing lot size and unusable quotes', async () => {
    const b = base();
    const noLot = makeDeps({ brokerFor: () => spy(b.adapter, { lotSize: async () => ({ ok: false, code: 'NOT_FOUND', message: 'no lot' }) }) });
    expect(await runScreenerCheck(noLot.deps, request(b))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    let calls = 0; // first call prices the long leg, second the short leg: a short leg worth more than the long leg is nonsense
    const stale = makeDeps({ brokerFor: () => spy(b.adapter, { quote: async () => { calls += 1; return { ok: true, value: calls === 1 ? { bid: 9, ask: 10, ltp: 9.5, oi: 1 } : { bid: 50, ask: 51, ltp: 50.5, oi: 1 } }; } }) });
    expect(await runScreenerCheck(stale.deps, request(b))).toMatchObject({ ok: false, code: 'BAD_QUOTES' });
  });

  it.each([
    ['unknown symbol', { symbol: 'NOSUCH' }],
    ['bad side', { side: 'long' }],
    ['non-numeric strike', { kLong: 'abc' }],
    ['malformed expiry', { expiry: '27OCT' }],
    ['inverted strikes for a bull spread', { kLong: 3000, kShort: 2000 }],
  ])('rejects %s as BAD_REQUEST without any broker call', async (_label, over) => {
    const b = base();
    const broker = spy(b.adapter);
    const { deps } = makeDeps({ brokerFor: () => broker });
    expect(await runScreenerCheck(deps, request(b, over))).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(broker.calls).toEqual([]);
  });

  it('only ever reads: quotes, lot size and open interest', async () => {
    const b = base();
    const broker = spy(b.adapter);
    const { deps } = makeDeps({ brokerFor: () => broker });
    await runScreenerCheck(deps, request(b));
    expect([...new Set(broker.calls.map((c) => c.method))].every((m) => ['quote', 'lotSize', 'optionOi'].includes(m))).toBe(true);
  });
});

describe('candidateDetail (chart series, levels and action plan)', () => {
  const input = (over: Record<string, unknown> = {}) => ({ source: 'synthetic', symbol: 'RELIANCE', side: 'bull', kLong: 100, kShort: 110, expiry: '2026-10-27', ...over });

  it('returns up to 260 sessions of close, SMAs and RSI (null while warming up), support and resistance and a plan', async () => {
    const { deps } = makeDeps({ universe: SIX, synthetic });
    const result = await candidateDetail(deps, input({ kLong: 100, kShort: 120 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.series.length).toBeLessThanOrEqual(260);
    const last = result.series[result.series.length - 1];
    expect(last.date).toBe('2026-10-06');
    expect(last).toMatchObject({ sma20: expect.any(Number), sma50: expect.any(Number), sma200: expect.any(Number), rsi: expect.any(Number) });
    expect(Array.isArray(result.levels.support)).toBe(true);
    expect(result.plan === null || result.plan.timeStop.date.length === 10).toBe(true);
  });

  it('uses the live debit for the plan when given, and says which basis it used', async () => {
    const { deps } = makeDeps({ universe: SIX, synthetic });
    const live = await candidateDetail(deps, input({ kLong: 100, kShort: 140, debit: 12 }));
    expect(live.ok && live.planBasis).toBe('live quote');
    expect(live.ok && live.plan?.profitTarget.spreadValue).toBeCloseTo(12 + 0.6 * (40 - 12), 9);
    const modelled = await candidateDetail(deps, input({ kLong: 100, kShort: 140 }));
    expect(modelled.ok && modelled.planBasis).toBe('modelled');
  });

  it('has no plan when the debit cannot make sense (live debit not inside the width)', async () => {
    const { deps } = makeDeps({ universe: SIX, synthetic });
    const result = await candidateDetail(deps, input({ kLong: 100, kShort: 110, debit: 50 }));
    expect(result.ok && result.plan).toBeNull();
  });

  it('reports NO_DATA for a live source whose candles have never been loaded, and BAD_REQUEST for an unknown symbol', async () => {
    const { deps } = makeDeps({ universe: SMALL_UNIVERSE });
    expect(await candidateDetail(deps, input({ source: 'fyers', symbol: 'RELIANCE' }))).toMatchObject({ ok: false, code: 'NO_DATA' });
    expect(await candidateDetail(deps, input({ symbol: 'NOSUCH' }))).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });
});
