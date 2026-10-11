import { describe, expect, it } from 'vitest';

import { buildBoard } from '@/lib/board/board';
import { advanceState, pollOnce } from '@/lib/board/poll';
import { parseOiCandles } from '@/lib/board/oi';
import { toSnapshotRow } from '@/lib/board/quotes';
import { createBoardStore } from '@/lib/board/store';
import { futuresSymbol } from '@/lib/board/universe';
import { createD1Fake } from '../support/d1-fake';

const stub = (fn: (url: URL) => unknown) => (async (input: URL | string) => {
  const body = fn(new URL(String(input)));
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

// A fake FYERS quotes endpoint: every requested symbol answers, futures also carry OI.
function quotesFetch(overrides: Record<string, Record<string, number>> = {}) {
  return stub((url) => ({
    s: 'ok',
    d: (url.searchParams.get('symbols') ?? '').split(',').map((n) => ({
      n, s: 'ok',
      v: { lp: 102, ch: 2, prev_close_price: 102, open_price: 100, high_price: 103, low_price: 99.5, volume: 2_000_000, atp: 101, ...overrides[n] },
    })),
  }));
}

const history = async () => ({ ok: true as const, candles: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, open: 100, high: 102, low: 98, close: 100, volume: 1_000_000 })) });

const oiOk = async () => ({ ok: true as const, value: { oi: 1_040_000, prevOi: 1_000_000, asOfDay: '2026-10-12' } });

const openMonday = new Date('2026-10-12T05:30:00Z'); // 11:00 IST, a Monday inside the session

describe('pollOnce', () => {
  const setup = () => {
    const db = createD1Fake(['drizzle/0004_board.sql']);
    const store = createBoardStore(db);
    return { db, store, deps: { store, credentials: { clientId: 'c', accessToken: 't' }, now: () => openMonday, quoteDeps: { fetchImpl: quotesFetch(), sleep: async () => {} }, dailyHistory: history, futuresOi: oiOk, sleep: async () => {} } };
  };

  it('stores one snapshot per stock and sector index, with the previous close taken as price minus change', async () => {
    const { deps, store } = setup();
    const summary = await pollOnce(deps);
    expect(summary.ok).toBe(true);
    expect(summary.stocks).toBeGreaterThan(150);
    expect(summary.withOi).toBe(40); // OI refreshes 40 futures per poll
    expect(summary.indices).toBeGreaterThan(5);
    const latest = await store.latestTs();
    expect(latest?.day).toBe('2026-10-12');
    const rows = await store.snapshotsAt(latest!.ts);
    const stock = rows.find((r) => r.symbol === 'NSE:INFY-EQ')!;
    expect(stock).toMatchObject({ ltp: 102, prevClose: 100, volume: 2_000_000, vwap: 101 }); // the feed's prev_close_price (102) is not used
  });

  it('is idempotent inside the same minute', async () => {
    const { deps, store } = setup();
    await pollOnce(deps);
    const first = await store.snapshotCount();
    const again = await pollOnce(deps);
    expect(again.skipped).toMatch(/already recorded/);
    expect(await store.snapshotCount()).toBe(first);
  });

  it('does nothing while the market is closed unless forced', async () => {
    const { deps, store } = setup();
    const closed = { ...deps, now: () => new Date('2026-10-11T08:00:00Z') }; // Sunday
    expect((await pollOnce(closed)).skipped).toBe('market closed');
    const forced = await pollOnce(closed, { force: true });
    expect(forced.ok).toBe(true);
    expect(forced.day).toBe('2026-10-09'); // dated to the last real session, Friday
    expect((await store.latestTs())?.day).toBe('2026-10-09');
  });

  it('skips a failed batch instead of throwing and reports it', async () => {
    const { deps } = setup();
    let calls = 0;
    const flaky = (async (input: URL | string) => {
      calls += 1;
      if (calls === 2) return new Response('{"s":"error","message":"boom"}', { status: 500 });
      return (await quotesFetch()(input)) as Response;
    }) as unknown as typeof fetch;
    const summary = await pollOnce({ ...deps, quoteDeps: { fetchImpl: flaky, sleep: async () => {} } });
    expect(summary.ok).toBe(true);
    expect(summary.failedBatches).toBeGreaterThan(0);
    expect(summary.errors.join(' ')).toMatch(/boom/);
    expect(summary.stocks).toBeGreaterThan(0);
  });

  it('reports a login problem and stores nothing', async () => {
    const { deps, store } = setup();
    const denied = (async () => new Response('{"s":"error","code":-16,"message":"token expired"}', { status: 200 })) as unknown as typeof fetch;
    const summary = await pollOnce({ ...deps, quoteDeps: { fetchImpl: denied, sleep: async () => {} } });
    expect(summary.loginRequired).toBe(true);
    expect(await store.snapshotCount()).toBe(0);
  });

  it('survives a symbol with no futures quote: OI is null, the stock is still stored', async () => {
    const { deps, store } = setup();
    const onlyEquity = stub((url) => ({ s: 'ok', d: (url.searchParams.get('symbols') ?? '').split(',').filter((n) => !n.endsWith('FUT')).map((n) => ({ n, s: 'ok', v: { lp: 50, ch: 1, volume: 10 } })) }));
    const summary = await pollOnce({ ...deps, futuresOi: async () => ({ ok: false as const, loginRequired: false, message: 'none' }), quoteDeps: { fetchImpl: onlyEquity, sleep: async () => {} } });
    expect(summary.stocks).toBeGreaterThan(0);
    expect(summary.withOi).toBe(0);
    expect((await store.snapshotsAt(summary.ts!))[0].oi).toBeNull();
  });

  it('rolls OI refreshes over the universe, oldest first, and carries earlier readings forward', async () => {
    const { deps, store } = setup();
    const first = await pollOnce(deps);
    expect(first.oi.refreshed).toBe(40);
    let clock = openMonday.getTime();
    const later = { ...deps, now: () => new Date((clock += 60_000)) };
    const second = await pollOnce(later);
    expect(second.oi.refreshed).toBe(40);
    expect(second.withOi).toBe(80); // 40 new plus the 40 carried forward
    const oi = await store.getOi();
    expect(new Set([...oi.values()].map((v) => v.updatedTs)).size).toBe(2);
  });

  it('a failing OI call is skipped and reported; the stock still records', async () => {
    const { deps } = setup();
    const summary = await pollOnce({ ...deps, futuresOi: async () => ({ ok: false as const, loginRequired: false, message: 'no OI column', shape: [1, 2] }) });
    expect(summary.ok).toBe(true);
    expect(summary.withOi).toBe(0);
    expect(summary.diagnostics?.oiFailures[0]).toMatch(/no OI column/);
    expect(summary.stocks).toBeGreaterThan(150);
  });

  it('fills daily baselines a few per poll', async () => {
    const { deps, store } = setup();
    const summary = await pollOnce(deps);
    expect(summary.baselines.done).toBe(30);
    expect((await store.getBaselines()).size).toBe(30);
    const b = [...(await store.getBaselines()).values()][0];
    expect(b.atrPct).toBeCloseTo(4, 3);
    expect(b.avgVolume).toBe(1_000_000);
  });
});

describe('advanceState', () => {
  const row = (ltp: number) => ({ symbol: 'S-EQ', ts: 0, ltp, volume: null, oi: null, prevOi: null, open: 100, high: null, low: null, prevClose: 100, vwap: 100 });
  it('counts a cross each time price changes side of VWAP and of the open', () => {
    let state = advanceState(undefined, 'S-EQ', 'd', row(101));
    expect(state.vwapCrossings).toBe(0);
    state = advanceState(state, 'S-EQ', 'd', row(99));
    state = advanceState(state, 'S-EQ', 'd', row(101));
    expect(state.vwapCrossings).toBe(2);
    expect(state.openCrossings).toBe(2);
  });
  it('does not count touching the line', () => {
    let state = advanceState(undefined, 'S-EQ', 'd', row(101));
    state = advanceState(state, 'S-EQ', 'd', row(100));
    state = advanceState(state, 'S-EQ', 'd', row(101));
    expect(state.vwapCrossings).toBe(0);
  });
});

describe('futures helpers', () => {
  it('names the current-month future and rolls after the expiry', () => {
    expect(futuresSymbol('INFY', '2026-10-12')).toBe('NSE:INFY26OCTFUT');
    expect(futuresSymbol('INFY', '2026-10-28')).toBe('NSE:INFY26NOVFUT');
  });
  it('reads OI and previous-day OI from the last two daily candles', () => {
    const day = (n: number) => Date.parse(`2026-10-${String(n).padStart(2, "0")}T00:00:00+05:30`) / 1000;
    const r = parseOiCandles([[day(8), 1, 2, 0.5, 1.5, 10, 900], [day(9), 1, 2, 0.5, 1.5, 10, 990]]);
    expect(r).toMatchObject({ ok: true, value: { oi: 990, prevOi: 900, asOfDay: '2026-10-09' } });
  });
  it('treats candles without an OI column as a reportable failure', () => {
    expect(parseOiCandles([[1, 1, 2, 0.5, 1.5, 10]])).toMatchObject({ ok: false, message: 'candles carried no OI column' });
    expect(parseOiCandles([])).toMatchObject({ ok: false });
  });
  it('rejects a quote without a price', () => {
    expect(toSnapshotRow('X', 0, { lp: 0 })).toBeNull();
  });
});

describe('buildBoard', () => {
  const universe = [
    { ticker: 'AAA', name: 'A', symbol: 'AAA', futures: '', sector: 'Banks', sectorIndex: 'IDX' },
    { ticker: 'BBB', name: 'B', symbol: 'BBB', futures: '', sector: 'Banks', sectorIndex: 'IDX' },
    { ticker: 'CCC', name: 'C', symbol: 'CCC', futures: '', sector: 'Banks', sectorIndex: 'IDX' },
    { ticker: 'DDD', name: 'D', symbol: 'DDD', futures: '', sector: 'Banks', sectorIndex: 'IDX' },
  ];
  const snap = (symbol: string, ltp: number, extra = {}) => ({ symbol, ts: 1, day: 'd', ltp, volume: 2_000_000, oi: 104, prevOi: 100, open: 100, high: ltp + 0.5, low: Math.min(ltp, 100) - 0.5, prevClose: 100, vwap: 100, ...extra });
  const baseline = (symbol: string) => [symbol, { symbol, asOf: 'd', atrPct: 2, avgVolume: 1_000_000, prevClose: 100 }] as const;
  const rows = [snap('AAA', 103), snap('BBB', 98), snap('CCC', 101), snap('IDX', 101, { volume: null, oi: null, prevClose: 100 })];

  it('splits into bullish and bearish lists, strongest first, and counts coverage', () => {
    const out = buildBoard({ universe, rows, baselines: new Map([baseline('AAA'), baseline('BBB'), baseline('CCC')]), states: new Map(), sameTimeVolumes: new Map(), minutes: 375 });
    expect(out.bullish.map((e) => e.ticker)).toEqual(['AAA', 'CCC']);
    expect(out.bearish.map((e) => e.ticker)).toEqual(['BBB']);
    expect(out.coverage).toMatchObject({ symbols: 4, scored: 3, withBaseline: 3, skipped: 1, withOi: 3 });
  });
  it('leaves out a choppy stock', () => {
    const states = new Map([['AAA', { symbol: 'AAA', day: 'd', vwapSide: 1, openSide: 1, vwapCrossings: 9, openCrossings: 0 }]]);
    const out = buildBoard({ universe, rows, baselines: new Map([baseline('AAA'), baseline('CCC')]), states, sameTimeVolumes: new Map(), minutes: 375 });
    expect(out.bullish.map((e) => e.ticker)).toEqual(['CCC']);
  });
  it('limits each list to the configured size', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ticker: `T${i}`, name: '', symbol: `T${i}`, futures: '', sector: 'Banks', sectorIndex: null }));
    const out = buildBoard({ universe: many, rows: many.map((m, i) => snap(m.symbol, 101 + i * 0.1)), baselines: new Map(many.map((m) => baseline(m.symbol))), states: new Map(), sameTimeVolumes: new Map(), minutes: 375 });
    expect(out.bullish).toHaveLength(20);
    expect(out.bullish[0].score).toBeGreaterThanOrEqual(out.bullish[19].score);
  });
});
