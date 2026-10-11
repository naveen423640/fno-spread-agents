import type { D1Like } from '../agents/store';
import type { Baseline, SnapshotRow } from './types';

// D1 storage for the OrderBlock Board. Tables come from drizzle/0004_board.sql; this store never creates them.
// D1 allows about 100 bound values per statement, so inserts go in small multi-row groups.

const COLUMNS = ['symbol', 'ts', 'day', 'ltp', 'volume', 'oi', 'prev_oi', 'open', 'high', 'low', 'prev_close', 'vwap'] as const;
const ROWS_PER_INSERT = 8; // 8 x 12 = 96 bound values

export type IntradayState = { symbol: string; day: string; vwapSide: number; openSide: number; vwapCrossings: number; openCrossings: number };
export type StoredSnapshot = SnapshotRow & { day: string };

type Raw = Record<string, string | number | null>;
const num = (v: unknown) => (typeof v === 'number' ? v : null);

function toSnapshot(row: Raw): StoredSnapshot {
  return {
    symbol: row.symbol as string, ts: row.ts as number, day: row.day as string, ltp: row.ltp as number,
    volume: num(row.volume), oi: num(row.oi), prevOi: num(row.prev_oi), open: num(row.open), high: num(row.high), low: num(row.low),
    prevClose: num(row.prev_close), vwap: num(row.vwap),
  };
}

export type BoardStore = {
  insertSnapshots(day: string, rows: SnapshotRow[]): Promise<void>;
  latestTs(): Promise<{ ts: number; day: string } | null>;
  snapshotsAt(ts: number): Promise<StoredSnapshot[]>;
  recentDays(limit: number, before?: string): Promise<string[]>;
  volumesNear(day: string, ts: number, windowSeconds: number): Promise<Map<string, number>>;
  snapshotCount(): Promise<number>;
  getBaselines(): Promise<Map<string, Baseline & { refreshedDay: string }>>;
  saveBaseline(baseline: Baseline, refreshedDay: string): Promise<void>;
  getOi(): Promise<Map<string, { oi: number; prevOi: number | null; asOfDay: string; updatedTs: number }>>;
  saveOi(symbol: string, reading: { oi: number; prevOi: number | null; asOfDay: string }, updatedTs: number): Promise<void>;
  getStates(day: string): Promise<Map<string, IntradayState>>;
  saveStates(states: IntradayState[]): Promise<void>;
};

export function createBoardStore(db: D1Like): BoardStore {
  return {
    async insertSnapshots(day, rows) {
      for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
        const group = rows.slice(i, i + ROWS_PER_INSERT);
        const marks = group.map(() => `(${COLUMNS.map(() => '?').join(', ')})`).join(', ');
        const values = group.flatMap((r) => [r.symbol, r.ts, day, r.ltp, r.volume, r.oi, r.prevOi, r.open, r.high, r.low, r.prevClose, r.vwap]);
        await db.prepare(`INSERT OR REPLACE INTO board_snapshots (${COLUMNS.join(', ')}) VALUES ${marks}`).bind(...values).run();
      }
    },
    async latestTs() {
      const row = await db.prepare('SELECT ts, day FROM board_snapshots ORDER BY ts DESC LIMIT 1').first<{ ts: number; day: string }>();
      return row ?? null;
    },
    async snapshotsAt(ts) {
      const { results } = await db.prepare('SELECT * FROM board_snapshots WHERE ts = ?').bind(ts).all<Raw>();
      return results.map(toSnapshot);
    },
    async recentDays(limit, before) {
      const sql = before
        ? 'SELECT DISTINCT day FROM board_snapshots WHERE day < ? ORDER BY day DESC LIMIT ?'
        : 'SELECT DISTINCT day FROM board_snapshots ORDER BY day DESC LIMIT ?';
      const stmt = db.prepare(sql);
      const { results } = await (before ? stmt.bind(before, limit) : stmt.bind(limit)).all<{ day: string }>();
      return results.map((r) => r.day);
    },
    // Cumulative volume per symbol at the latest recorded minute inside [ts - windowSeconds, ts] on that day.
    async volumesNear(day, ts, windowSeconds) {
      const { results } = await db.prepare('SELECT symbol, volume FROM board_snapshots WHERE day = ? AND ts BETWEEN ? AND ? AND volume IS NOT NULL ORDER BY ts ASC')
        .bind(day, ts - windowSeconds, ts).all<{ symbol: string; volume: number }>();
      const out = new Map<string, number>();
      for (const r of results) out.set(r.symbol, r.volume); // ascending, so the latest wins
      return out;
    },
    async snapshotCount() {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM board_snapshots').first<{ n: number }>();
      return row?.n ?? 0;
    },
    async getBaselines() {
      const { results } = await db.prepare('SELECT symbol, refreshed_day, as_of, atr_pct, avg_volume, prev_close FROM board_baselines').all<Raw>();
      return new Map(results.map((r) => [r.symbol as string, { symbol: r.symbol as string, asOf: r.as_of as string, atrPct: r.atr_pct as number, avgVolume: r.avg_volume as number, prevClose: r.prev_close as number, refreshedDay: r.refreshed_day as string }]));
    },
    async saveBaseline(b, refreshedDay) {
      await db.prepare('INSERT OR REPLACE INTO board_baselines (symbol, refreshed_day, as_of, atr_pct, avg_volume, prev_close) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(b.symbol, refreshedDay, b.asOf, b.atrPct, b.avgVolume, b.prevClose).run();
    },
    async getOi() {
      const { results } = await db.prepare('SELECT symbol, oi, prev_oi, as_of_day, updated_ts FROM board_oi').all<Raw>();
      return new Map(results.map((r) => [r.symbol as string, { oi: r.oi as number, prevOi: num(r.prev_oi), asOfDay: r.as_of_day as string, updatedTs: r.updated_ts as number }]));
    },
    async saveOi(symbol, reading, updatedTs) {
      await db.prepare('INSERT OR REPLACE INTO board_oi (symbol, oi, prev_oi, as_of_day, updated_ts) VALUES (?, ?, ?, ?, ?)').bind(symbol, reading.oi, reading.prevOi, reading.asOfDay, updatedTs).run();
    },
    async getStates(day) {
      const { results } = await db.prepare('SELECT symbol, day, vwap_side, open_side, vwap_crossings, open_crossings FROM board_intraday_state WHERE day = ?').bind(day).all<Raw>();
      return new Map(results.map((r) => [r.symbol as string, { symbol: r.symbol as string, day: r.day as string, vwapSide: r.vwap_side as number, openSide: r.open_side as number, vwapCrossings: r.vwap_crossings as number, openCrossings: r.open_crossings as number }]));
    },
    async saveStates(states) {
      for (const s of states) {
        await db.prepare('INSERT OR REPLACE INTO board_intraday_state (symbol, day, vwap_side, open_side, vwap_crossings, open_crossings) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(s.symbol, s.day, s.vwapSide, s.openSide, s.vwapCrossings, s.openCrossings).run();
      }
    },
  };
}
