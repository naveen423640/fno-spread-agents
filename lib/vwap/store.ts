import type { D1Like } from '../agents/store';
import type { PriorTotals } from './core';

// D1 cache for the monthly VWAP. One row per symbol and completed day holds the month's running totals at that day's close, so a scan
// only needs today's candles. Tables come from drizzle/0006_vwap.sql; this store never creates them.
type Raw = Record<string, string | number | null>;

export type DayTotals = { symbol: string; month: string; day: string; sumPv: number; sumV: number; lastClose: number; lastVwap: number | null; dayOpen: number; dayVolume: number };
export type MonthState = { checkedThrough: string; unreliable: boolean; unreliableNote: string };

export type VwapStore = {
  state(symbol: string, month: string): Promise<MonthState | null>;
  saveState(symbol: string, month: string, state: MonthState): Promise<void>;
  saveDay(row: DayTotals): Promise<void>;
  // Running totals as of the last cached day strictly before `day` in that month, plus the average daily volume of those days.
  priorFor(symbol: string, month: string, day: string): Promise<{ prior: PriorTotals; days: number; avgDailyVolume: number | null }>;
  getUniverse(name: string): Promise<{ symbols: unknown; fetchedDay: string } | null>;
  saveUniverse(name: string, symbols: unknown, fetchedDay: string): Promise<void>;
};

export function createVwapStore(db: D1Like): VwapStore {
  return {
    async state(symbol, month) {
      const r = await db.prepare('SELECT checked_through, unreliable, unreliable_note FROM vwap_month_state WHERE symbol = ? AND month = ?').bind(symbol, month).first<Raw>();
      return r ? { checkedThrough: r.checked_through as string, unreliable: r.unreliable === 1, unreliableNote: r.unreliable_note as string } : null;
    },
    async saveState(symbol, month, s) {
      await db.prepare('INSERT OR REPLACE INTO vwap_month_state (symbol, month, checked_through, unreliable, unreliable_note) VALUES (?, ?, ?, ?, ?)').bind(symbol, month, s.checkedThrough, s.unreliable ? 1 : 0, s.unreliableNote).run();
    },
    async saveDay(r) {
      await db.prepare('INSERT OR REPLACE INTO vwap_day_totals (symbol, month, day, sum_pv, sum_v, last_close, last_vwap, day_open, day_volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(r.symbol, r.month, r.day, r.sumPv, r.sumV, r.lastClose, r.lastVwap, r.dayOpen, r.dayVolume).run();
    },
    async priorFor(symbol, month, day) {
      const { results } = await db.prepare('SELECT day, sum_pv, sum_v, last_close, last_vwap, day_volume FROM vwap_day_totals WHERE symbol = ? AND month = ? AND day < ? ORDER BY day ASC').bind(symbol, month, day).all<Raw>();
      if (!results.length) return { prior: { sumPv: 0, sumV: 0, lastClose: null, lastVwap: null }, days: 0, avgDailyVolume: null };
      const last = results[results.length - 1];
      const volumes = results.map((r) => r.day_volume as number);
      return {
        prior: { sumPv: last.sum_pv as number, sumV: last.sum_v as number, lastClose: last.last_close as number, lastVwap: (last.last_vwap as number | null) ?? null },
        days: results.length,
        avgDailyVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length,
      };
    },
    async getUniverse(name) {
      const r = await db.prepare('SELECT symbols_json, fetched_day FROM vwap_universe WHERE name = ?').bind(name).first<Raw>();
      return r ? { symbols: JSON.parse(r.symbols_json as string) as unknown, fetchedDay: r.fetched_day as string } : null;
    },
    async saveUniverse(name, symbols, fetchedDay) {
      await db.prepare('INSERT OR REPLACE INTO vwap_universe (name, symbols_json, fetched_day) VALUES (?, ?, ?)').bind(name, JSON.stringify(symbols), fetchedDay).run();
    },
  };
}
