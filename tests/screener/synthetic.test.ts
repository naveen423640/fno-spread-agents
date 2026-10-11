import { describe, expect, it } from 'vitest';

import { createMockAdapter } from '../../lib/screener/broker/mock';
import { UNIVERSE } from '../../lib/screener/config';
import { makeSynthetic, mulberry32 } from '../../lib/screener/synthetic';

describe('mulberry32', () => {
  it('is deterministic per seed, in [0, 1), and differs across seeds', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(8)()).not.toBe(first[0]);
  });
});

describe('makeSynthetic (same recipe as the reference synthetic(); different random numbers)', () => {
  const { data, bench } = makeSynthetic({ stocks: 6, days: 400, seed: 3, endDate: '2026-10-02' });

  it('returns the first N universe symbols plus a benchmark, all with the same dates', () => {
    expect(Object.keys(data)).toEqual(Object.keys(UNIVERSE).slice(0, 6));
    for (const candles of Object.values(data)) expect(candles.map((c) => c.date)).toEqual(bench.map((c) => c.date));
  });

  it('is deterministic for a seed and different for another', () => {
    expect(makeSynthetic({ stocks: 2, days: 50, seed: 3, endDate: '2026-10-02' }).data).toEqual(makeSynthetic({ stocks: 2, days: 50, seed: 3, endDate: '2026-10-02' }).data);
    expect(makeSynthetic({ stocks: 2, days: 50, seed: 4, endDate: '2026-10-02' }).data).not.toEqual(makeSynthetic({ stocks: 2, days: 50, seed: 3, endDate: '2026-10-02' }).data);
  });

  it('dates are ascending weekdays ending on the end date', () => {
    const dates = bench.map((c) => c.date);
    expect(dates).toHaveLength(400);
    expect(dates[dates.length - 1]).toBe('2026-10-02');
    for (let i = 1; i < dates.length; i += 1) expect(dates[i] > dates[i - 1]).toBe(true);
    for (const d of dates) expect([0, 6]).not.toContain(new Date(`${d}T00:00:00Z`).getUTCDay());
  });

  it('candles are well-formed: high above and low below open and close, positive volume', () => {
    for (const c of [...bench, ...Object.values(data).flat()]) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(c.low).toBeGreaterThan(0);
      expect(c.volume).toBeGreaterThan(0);
    }
  });
});

describe('mock adapter', () => {
  const { data, bench } = makeSynthetic({ stocks: 3, days: 300, seed: 3, endDate: '2026-10-02' });
  const adapter = createMockAdapter({ data, bench, lots: { RELIANCE: 250 } });
  const symbol = Object.keys(data)[0];

  it('serves history for the requested range from the synthetic data', async () => {
    const result = await adapter.history(adapter.equitySymbol(symbol), { from: '2026-09-01', to: '2026-09-30' });
    expect(result.ok && result.value.every((c) => c.date >= '2026-09-01' && c.date <= '2026-09-30')).toBe(true);
    expect(result.ok && result.value.length).toBeGreaterThan(10);
    const index = await adapter.history(adapter.indexSymbol(), { from: '2026-09-01', to: '2026-09-30' });
    expect(index.ok).toBe(true);
    expect(await adapter.history('NSE:NOSUCH-EQ', { from: '2026-09-01', to: '2026-09-30' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('prices an option quote with a bid below the ask and an OI', async () => {
    const last = data[symbol][data[symbol].length - 1].close;
    const q = await adapter.quote(adapter.optionSymbol(symbol, '2026-10-27', Math.round(last), 'CE'));
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.value.bid).not.toBeNull();
    expect(q.value.ask).not.toBeNull();
    expect((q.value.bid as number) < (q.value.ask as number)).toBe(true);
    expect(q.value.oi).toBeGreaterThan(0);
  });

  it('knows configured lot sizes and reports NOT_FOUND for others', async () => {
    expect(await adapter.lotSize('RELIANCE', '2026-10-27')).toEqual({ ok: true, value: 250 });
    expect(await adapter.lotSize('NOSUCH', '2026-10-27')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
