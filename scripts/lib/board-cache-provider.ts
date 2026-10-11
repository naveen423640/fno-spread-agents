import { DatabaseSync } from 'node:sqlite';

import type { D1Like } from '../../lib/agents/store';
import { createBoardCacheProvider as fromD1 } from '../../lib/vwap/cache-provider';
import type { DataProvider } from '../../lib/vwap/provider';

// The CLI opens the local dev database read-only and reads candles through the same provider the app uses.
export function createBoardCacheProvider(path: string): DataProvider {
  const sqlite = new DatabaseSync(path, { readOnly: true });
  const db: D1Like = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const build = (values: (string | number | null)[]) => ({
        async run() { statement.run(...values); return { success: true }; },
        async first<T = Record<string, unknown>>() { return (statement.get(...values) as T | undefined) ?? null; },
        async all<T = Record<string, unknown>>() { return { results: statement.all(...values) as T[] }; },
      });
      return { ...build([]), bind: (...values: (string | number | null)[]) => build(values) };
    },
  };
  return fromD1(db);
}
