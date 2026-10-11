// Serves 5-minute candles from the OrderBlock Board's cached history (board_m5 in the local dev database), so scans and golden checks can
// run offline on data already fetched. It never calls FYERS.
import { DatabaseSync } from 'node:sqlite';

import type { C5 } from '../../lib/vwap/core';
import type { DataProvider } from '../../lib/vwap/provider';

export function createBoardCacheProvider(path: string): DataProvider {
  const sqlite = new DatabaseSync(path, { readOnly: true });
  const query = sqlite.prepare('SELECT day, candles_json FROM board_m5 WHERE symbol = ? AND day >= ? AND day <= ? ORDER BY day ASC');
  return {
    name: 'board-cache',
    async candles5m(symbol, fromDay, toDay) {
      const rows = query.all(symbol, fromDay, toDay) as { day: string; candles_json: string }[];
      const candles: C5[] = rows.flatMap((r) => (JSON.parse(r.candles_json) as number[][]).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })));
      return { ok: true as const, value: candles };
    },
  };
}
