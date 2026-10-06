import { describe, expect, it } from 'vitest';

import { buildConfig, failureStatus, jobView, latestView, parseCheckQuery } from '../../lib/screener/api';
import { DEFAULT_PARAMS, UNIVERSE } from '../../lib/screener/config';
import { makeDeps } from '../support/screener-service';

describe('jobView', () => {
  it('exposes status, progress, message, result and timing, and nothing else', async () => {
    const { store } = makeDeps();
    await store.createJob({ id: 'j1', kind: 'scan', source: 'synthetic', params: DEFAULT_PARAMS });
    await store.updateJob('j1', { progress: 55, message: 'Loading candles 3/5' });
    const job = await store.getJob('j1');
    expect(jobView(job as NonNullable<typeof job>)).toEqual({
      id: 'j1', kind: 'scan', source: 'synthetic', params: DEFAULT_PARAMS, status: 'running', progress: 55, message: 'Loading candles 3/5',
      result: null, createdAt: expect.any(String), completedAt: null,
    });
  });
});

describe('latestView', () => {
  it('says none when nothing has finished yet', async () => {
    const { deps } = makeDeps();
    expect(await latestView(deps, 'scan', 'synthetic')).toEqual({ status: 'none' });
  });

  it('returns the newest finished job for the kind and source', async () => {
    const { deps, store } = makeDeps();
    await store.createJob({ id: 'a', kind: 'scan', source: 'synthetic', params: DEFAULT_PARAMS });
    await store.updateJob('a', { status: 'done', progress: 100, message: 'Done', result: { rows: [] } });
    const view = await latestView(deps, 'scan', 'synthetic');
    expect(view).toMatchObject({ status: 'ok', job: { id: 'a', result: { rows: [] } } });
    expect(await latestView(deps, 'backtest', 'synthetic')).toEqual({ status: 'none' });
  });

  it('rejects an unknown source', async () => {
    const { deps } = makeDeps();
    expect(await latestView(deps, 'scan', 'yahoo')).toEqual({ status: 'error', error: 'source must be "fyers", "kite" or "synthetic".', httpStatus: 400 });
    expect(await latestView(deps, 'scan', null)).toMatchObject({ status: 'error', httpStatus: 400 });
  });
});

describe('parseCheckQuery', () => {
  it('reads the source, symbol, side, strikes, expiry and optional debit from the query string', () => {
    const q = parseCheckQuery(new URLSearchParams('source=fyers&symbol=HAL&side=bull&kLong=4800&kShort=5100&expiry=2026-10-27&debit=80.5&lot=150'));
    expect(q).toEqual({ source: 'fyers', symbol: 'HAL', side: 'bull', kLong: 4800, kShort: 5100, expiry: '2026-10-27', debit: 80.5, lot: 150 });
  });

  it('turns missing values into undefined and non-numbers into NaN so validation rejects them', () => {
    const q = parseCheckQuery(new URLSearchParams('symbol=HAL&kLong=abc'));
    expect(q.source).toBeUndefined();
    expect(q.kShort).toBeUndefined();
    expect(q.debit).toBeUndefined();
    expect(q.lot).toBeUndefined();
    expect(Number.isNaN(q.kLong)).toBe(true);
  });
});

describe('failureStatus', () => {
  it.each([['LOGIN_REQUIRED', 401], ['NOT_FOUND', 404], ['BAD_REQUEST', 400], ['BAD_QUOTES', 422], ['NO_DATA', 404], ['UPSTREAM', 502], ['NOT_CONFIGURED', 503]] as const)('%s -> %i', (code, status) => {
    expect(failureStatus(code)).toBe(status);
  });
});

describe('buildConfig', () => {
  it('lists the defaults, sectors, the sources with their availability and the 100-trade minimum', () => {
    const config = buildConfig({ liveBroker: 'fyers', liveConnected: false });
    expect(config.defaults).toEqual(DEFAULT_PARAMS);
    expect(config.sectors).toEqual([...new Set(Object.values(UNIVERSE))].sort());
    expect(config.universeSize).toBe(Object.keys(UNIVERSE).length);
    expect(config.sources).toEqual([
      { id: 'synthetic', label: 'Synthetic data (dry run)', available: true },
      { id: 'fyers', label: 'FYERS (live)', available: false },
    ]);
    expect(config.minTrades).toBe(100);
    expect(config.liveBroker).toBe('fyers');
  });

  it('labels Kite and marks it available when connected', () => {
    expect(buildConfig({ liveBroker: 'kite', liveConnected: true }).sources[1]).toEqual({ id: 'kite', label: 'Kite (live)', available: true });
  });
});
