import { describe, expect, it } from 'vitest';

import { createScreenerStore } from '../../lib/screener/store';
import type { Candle } from '../../lib/screener/types';
import { createD1Fake } from '../support/d1-fake';

const MIGRATIONS = ['drizzle/0000_preflight.sql', 'drizzle/0001_strategy_lab_reports.sql', 'drizzle/0002_agent_team.sql', 'drizzle/0003_screener.sql'];
const NOW = new Date('2026-10-06T11:00:00.000Z');
const candle = (date: string, close: number): Candle => ({ date, open: close, high: close + 1, low: close - 1, close, volume: 100 });
const make = () => createScreenerStore(createD1Fake(MIGRATIONS), () => NOW);

describe('candle cache', () => {
  it('stores and returns candles in date order with their first and last dates', async () => {
    const store = make();
    await store.saveCandles('fyers', 'HAL', [candle('2026-10-02', 3), candle('2026-09-30', 1), candle('2026-10-01', 2)]);
    const cached = await store.getCandles('fyers', 'HAL');
    expect(cached?.candles.map((c) => c.date)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
    expect(cached).toMatchObject({ firstDate: '2026-09-30', lastDate: '2026-10-02', coversFrom: '2026-09-30', refreshedAt: NOW.toISOString() });
  });

  it('remembers how far back the last request reached, even when the broker had less history', async () => {
    const store = make();
    await store.saveCandles('fyers', 'NEWLISTING', [candle('2026-09-01', 1), candle('2026-09-02', 2)], '2024-10-06');
    expect(await store.getCandles('fyers', 'NEWLISTING')).toMatchObject({ firstDate: '2026-09-01', coversFrom: '2024-10-06' });
  });

  it('replaces the previous rows for a symbol and keeps sources and symbols apart', async () => {
    const store = make();
    await store.saveCandles('fyers', 'HAL', [candle('2026-10-01', 1)]);
    await store.saveCandles('fyers', 'HAL', [candle('2026-10-02', 2)]);
    await store.saveCandles('kite', 'HAL', [candle('2026-10-03', 3)]);
    await store.saveCandles('fyers', 'BEL', [candle('2026-10-04', 4)]);
    expect((await store.getCandles('fyers', 'HAL'))?.candles).toEqual([candle('2026-10-02', 2)]);
    expect((await store.getCandles('kite', 'HAL'))?.candles).toEqual([candle('2026-10-03', 3)]);
    expect((await store.getCandles('fyers', 'BEL'))?.candles).toEqual([candle('2026-10-04', 4)]);
  });

  it('returns null for an unknown symbol and ignores an empty save', async () => {
    const store = make();
    expect(await store.getCandles('fyers', 'NOPE')).toBeNull();
    await store.saveCandles('fyers', 'HAL', []);
    expect(await store.getCandles('fyers', 'HAL')).toBeNull();
  });
});

describe('jobs', () => {
  const params = { holdDays: 20 };

  it('creates a running job and reads it back', async () => {
    const store = make();
    await store.createJob({ id: 'j1', kind: 'scan', source: 'synthetic', params });
    expect(await store.getJob('j1')).toMatchObject({ id: 'j1', kind: 'scan', source: 'synthetic', params, status: 'running', progress: 0, result: null, createdAt: NOW.toISOString(), completedAt: null });
    expect(await store.getJob('missing')).toBeNull();
  });

  it('updates progress, message, status and result', async () => {
    const store = make();
    await store.createJob({ id: 'j1', kind: 'backtest', source: 'fyers', params });
    await store.updateJob('j1', { progress: 40, message: 'Loading candles' });
    expect(await store.getJob('j1')).toMatchObject({ progress: 40, message: 'Loading candles', status: 'running' });
    await store.updateJob('j1', { status: 'done', progress: 100, message: 'Done', result: { rows: [1, 2] } });
    expect(await store.getJob('j1')).toMatchObject({ status: 'done', progress: 100, result: { rows: [1, 2] }, completedAt: NOW.toISOString() });
  });

  it('latestDone returns the newest finished job of a kind and source, ignoring running and failed ones', async () => {
    const store = make();
    for (const [id, status] of [['a', 'done'], ['b', 'failed'], ['c', 'running']] as const) {
      await store.createJob({ id, kind: 'scan', source: 'fyers', params });
      if (status !== 'running') await store.updateJob(id, { status, progress: 100, message: status, result: { id } });
    }
    await store.createJob({ id: 'd', kind: 'scan', source: 'synthetic', params });
    await store.updateJob('d', { status: 'done', progress: 100, message: 'x', result: { id: 'd' } });
    expect((await store.latestDone('scan', 'fyers'))?.id).toBe('a');
    expect((await store.latestDone('scan', 'synthetic'))?.id).toBe('d');
    expect(await store.latestDone('backtest', 'fyers')).toBeNull();
  });

  it('counts jobs created since a time', async () => {
    const store = make();
    for (const id of ['a', 'b', 'c']) await store.createJob({ id, kind: 'scan', source: 'fyers', params });
    expect(await store.countJobsSince('2026-10-06T10:00:00.000Z')).toBe(3);
    expect(await store.countJobsSince('2026-10-06T11:00:01.000Z')).toBe(0);
  });
});
