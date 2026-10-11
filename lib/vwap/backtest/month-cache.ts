import type { D1Like } from '../../agents/store';
import { istDayOf, type C5 } from '../core';
import type { DataProvider } from '../provider';

// Reads only what createCachingProvider has already stored (vwap_m5_month). It never calls FYERS, so a backtest run in the app is
// repeatable and cannot stall on the network; fill the cache first with the load step.
export function createMonthCacheProvider(db: D1Like): DataProvider {
  return {
    name: 'month-cache',
    async candles5m(symbol, fromDay, toDay) {
      const row = await db.prepare('SELECT candles_json FROM vwap_m5_month WHERE symbol = ? AND month = ?').bind(symbol, fromDay.slice(0, 7)).first<{ candles_json: string }>();
      if (!row) return { ok: true as const, value: [] };
      const candles: C5[] = (JSON.parse(row.candles_json) as number[][]).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
      return { ok: true as const, value: candles.filter((c) => { const d = istDayOf(c.t); return d >= fromDay && d <= toDay; }) };
    },
  };
}
