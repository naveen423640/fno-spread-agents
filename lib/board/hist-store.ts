import type { D1Like } from '../agents/store';
import type { Candle } from '../screener/types';
import type { C5 } from './zones';

// D1 cache for the backtest's history: 5-minute candles one row per symbol and day (D1 rows are limited to 2 MB), and small
// per-symbol series (daily candles, daily futures OI). A symbol counts as loaded once its 'done' marker is written, last.
export type LoadedHistory = { m5: Map<string, Map<string, C5[]>>; daily: Map<string, Candle[]>; oi: Map<string, Map<string, number>> };

type Raw = Record<string, string | number | null>;

export type HistStore = {
  loadedSymbols(): Promise<Set<string>>;
  saveSymbol(symbol: string, data: { m5: Map<string, C5[]>; daily: Candle[]; oi: [string, number][] }, loadedDay: string): Promise<void>;
  loadAll(): Promise<LoadedHistory>;
};

export function createHistStore(db: D1Like): HistStore {
  return {
    async loadedSymbols() {
      const { results } = await db.prepare("SELECT symbol FROM board_hist WHERE kind = 'done'").all<Raw>();
      return new Set(results.map((r) => r.symbol as string));
    },
    async saveSymbol(symbol, data, loadedDay) {
      for (const [day, candles] of data.m5) {
        await db.prepare('INSERT OR REPLACE INTO board_m5 (symbol, day, candles_json) VALUES (?, ?, ?)').bind(symbol, day, JSON.stringify(candles.map((c) => [c.t, c.o, c.h, c.l, c.c, c.v]))).run();
      }
      await db.prepare("INSERT OR REPLACE INTO board_hist (kind, symbol, data_json, loaded_day) VALUES ('daily', ?, ?, ?)").bind(symbol, JSON.stringify(data.daily), loadedDay).run();
      await db.prepare("INSERT OR REPLACE INTO board_hist (kind, symbol, data_json, loaded_day) VALUES ('oi', ?, ?, ?)").bind(symbol, JSON.stringify(data.oi), loadedDay).run();
      await db.prepare("INSERT OR REPLACE INTO board_hist (kind, symbol, data_json, loaded_day) VALUES ('done', ?, '1', ?)").bind(symbol, loadedDay).run();
    },
    async loadAll() {
      const done = await this.loadedSymbols();
      const m5 = new Map<string, Map<string, C5[]>>();
      const { results: rows } = await db.prepare('SELECT symbol, day, candles_json FROM board_m5').all<Raw>();
      for (const r of rows) {
        const symbol = r.symbol as string;
        if (!done.has(symbol)) continue;
        const days = m5.get(symbol) ?? new Map<string, C5[]>();
        days.set(r.day as string, (JSON.parse(r.candles_json as string) as number[][]).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })));
        m5.set(symbol, days);
      }
      const daily = new Map<string, Candle[]>();
      const oi = new Map<string, Map<string, number>>();
      const { results: hist } = await db.prepare("SELECT kind, symbol, data_json FROM board_hist WHERE kind IN ('daily', 'oi')").all<Raw>();
      for (const r of hist) {
        const symbol = r.symbol as string;
        if (!done.has(symbol)) continue;
        if (r.kind === 'daily') daily.set(symbol, JSON.parse(r.data_json as string) as Candle[]);
        else oi.set(symbol, new Map(JSON.parse(r.data_json as string) as [string, number][]));
      }
      return { m5, daily, oi };
    },
  };
}
