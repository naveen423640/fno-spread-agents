// Serves 5-minute candles from the OrderBlock Board's cached history (the board_m5 table), so the scanner can run offline on data that
// was already fetched. It never calls FYERS. Works with any D1-shaped database, in the app and in the CLI.
import type { D1Like } from '../agents/store';
import type { C5 } from './core';
import type { DataProvider } from './provider';

export function createBoardCacheProvider(db: D1Like): DataProvider {
  return {
    name: 'board-cache',
    async candles5m(symbol, fromDay, toDay) {
      const { results } = await db.prepare('SELECT candles_json FROM board_m5 WHERE symbol = ? AND day >= ? AND day <= ? ORDER BY day ASC').bind(symbol, fromDay, toDay).all<{ candles_json: string }>();
      const candles: C5[] = results.flatMap((r) => (JSON.parse(r.candles_json) as number[][]).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })));
      return { ok: true as const, value: candles };
    },
  };
}
