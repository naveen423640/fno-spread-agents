import type { D1Like } from '../agents/store';
import { istDate } from './time';
import type { ChainRow, Side, Snapshot } from './types';

// D1 storage for the LTP Levels recorder and tab. Tables come from drizzle/0008_ltp.sql; this store never creates them. Snapshots are kept in
// long format, one row per strike and side, keyed (underlying, expiry, snapshot_ts, strike, side) so a repeated minute adds nothing.
type Raw = Record<string, string | number | null>;

export type Gap = { underlying: string; minuteTs: number; reason: string; detail?: string };
export type CalibrationEntry = { id: string; underlying: string; entryTs: number; label: string; actual: number; snapshotTs: number; proxies: Record<string, number | null> };

const COLUMNS = ['underlying', 'expiry', 'snapshot_ts', 'trade_date', 'strike', 'side', 'ltp', 'oi', 'oi_change', 'volume', 'spot', 'step', 'fetch_latency_ms', 'flags'];
const ROWS_PER_INSERT = 7; // 7 x 14 = 98 bound values, under D1's limit of 100 per statement

export type LtpStore = {
  insertSnapshot(s: Snapshot): Promise<{ inserted: number }>;
  snapshotsForDay(underlying: string, date: string): Promise<Snapshot[]>;
  latest(underlying: string): Promise<Snapshot | null>;
  lastSnapshotTs(underlying: string): Promise<number | null>;
  latestDate(underlying: string): Promise<string | null>;
  countForDay(underlying: string, date: string): Promise<number>;
  firstDateForExpiry(underlying: string, expiry: string): Promise<string | null>;
  addGap(g: Gap): Promise<void>;
  gapsForDay(date: string): Promise<Required<Gap>[]>;
  saveLines0920(date: string, underlying: string, lines: unknown): Promise<void>;
  getLines0920(date: string, underlying: string): Promise<unknown>;
  saveWeekly(weekStart: string, underlying: string, range: unknown): Promise<void>;
  getWeekly(weekStart: string, underlying: string): Promise<unknown>;
  addCalibration(e: CalibrationEntry): Promise<void>;
  calibrationEntries(underlying: string): Promise<CalibrationEntry[]>;
};

const toRow = (r: Raw): { snapshotTs: number; expiry: string; underlying: string; spot: number; step: number; latency: number | null; row: ChainRow } => ({
  snapshotTs: r.snapshot_ts as number, expiry: r.expiry as string, underlying: r.underlying as string, spot: r.spot as number, step: r.step as number, latency: (r.fetch_latency_ms as number | null) ?? null,
  row: { strike: r.strike as number, side: r.side as Side, ltp: (r.ltp as number | null) ?? null, oi: (r.oi as number | null) ?? null, oiChange: (r.oi_change as number | null) ?? null, volume: (r.volume as number | null) ?? null, flags: (r.flags as string) ? (r.flags as string).split(',') : [] },
});

function group(rows: Raw[]): Snapshot[] {
  const map = new Map<string, Snapshot>();
  for (const raw of rows) {
    const x = toRow(raw);
    const key = `${x.snapshotTs}|${x.expiry}`;
    const snap = map.get(key) ?? { ts: x.snapshotTs, underlying: x.underlying, expiry: x.expiry, spot: x.spot, step: x.step, fetchLatencyMs: x.latency, rows: [] };
    snap.rows.push(x.row);
    map.set(key, snap);
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

export function createLtpStore(db: D1Like): LtpStore {
  const json = (v: unknown) => JSON.stringify(v);
  const one = async (sql: string, ...bind: (string | number)[]) => db.prepare(sql).bind(...bind).first<Raw>();
  return {
    async insertSnapshot(s) {
      const count = async () => ((await one('SELECT COUNT(*) AS n FROM ltp_snapshots WHERE underlying = ? AND expiry = ? AND snapshot_ts = ?', s.underlying, s.expiry, s.ts))?.n as number) ?? 0;
      const before = await count();
      const date = istDate(s.ts);
      for (let i = 0; i < s.rows.length; i += ROWS_PER_INSERT) {
        const group = s.rows.slice(i, i + ROWS_PER_INSERT);
        const marks = group.map(() => `(${COLUMNS.map(() => '?').join(', ')})`).join(', ');
        const values = group.flatMap((r) => [s.underlying, s.expiry, s.ts, date, r.strike, r.side, r.ltp, r.oi, r.oiChange, r.volume, s.spot, s.step, s.fetchLatencyMs, r.flags.join(',')]);
        await db.prepare(`INSERT OR IGNORE INTO ltp_snapshots (${COLUMNS.join(', ')}) VALUES ${marks}`).bind(...values).run();
      }
      return { inserted: (await count()) - before };
    },
    async snapshotsForDay(underlying, date) {
      const { results } = await db.prepare('SELECT * FROM ltp_snapshots WHERE underlying = ? AND trade_date = ? ORDER BY snapshot_ts ASC, strike ASC, side ASC').bind(underlying, date).all<Raw>();
      return group(results);
    },
    async lastSnapshotTs(underlying) {
      return ((await one('SELECT MAX(snapshot_ts) AS t FROM ltp_snapshots WHERE underlying = ?', underlying))?.t as number | null) ?? null;
    },
    async latest(underlying) {
      const ts = await this.lastSnapshotTs(underlying);
      if (ts === null) return null;
      const { results } = await db.prepare('SELECT * FROM ltp_snapshots WHERE underlying = ? AND snapshot_ts = ? ORDER BY strike ASC, side ASC').bind(underlying, ts).all<Raw>();
      return group(results)[0] ?? null;
    },
    async latestDate(underlying) {
      return ((await one('SELECT trade_date AS d FROM ltp_snapshots WHERE underlying = ? ORDER BY snapshot_ts DESC LIMIT 1', underlying))?.d as string | undefined) ?? null;
    },
    async countForDay(underlying, date) {
      return ((await one('SELECT COUNT(DISTINCT snapshot_ts) AS n FROM ltp_snapshots WHERE underlying = ? AND trade_date = ?', underlying, date))?.n as number) ?? 0;
    },
    async firstDateForExpiry(underlying, expiry) {
      return ((await one('SELECT MIN(trade_date) AS d FROM ltp_snapshots WHERE underlying = ? AND expiry = ?', underlying, expiry))?.d as string | null) ?? null;
    },
    async addGap(g) {
      await db.prepare('INSERT OR IGNORE INTO recorder_gaps (underlying, minute_ts, trade_date, reason, detail) VALUES (?, ?, ?, ?, ?)').bind(g.underlying, g.minuteTs, istDate(g.minuteTs), g.reason, g.detail ?? '').run();
    },
    async gapsForDay(date) {
      const { results } = await db.prepare('SELECT underlying, minute_ts, reason, detail FROM recorder_gaps WHERE trade_date = ? ORDER BY minute_ts ASC, underlying ASC').bind(date).all<Raw>();
      return results.map((r) => ({ underlying: r.underlying as string, minuteTs: r.minute_ts as number, reason: r.reason as string, detail: r.detail as string }));
    },
    async saveLines0920(date, underlying, lines) {
      await db.prepare('INSERT OR IGNORE INTO ltp_lines_0920 (trade_date, underlying, json) VALUES (?, ?, ?)').bind(date, underlying, json(lines)).run();
    },
    async getLines0920(date, underlying) {
      const r = await one('SELECT json FROM ltp_lines_0920 WHERE trade_date = ? AND underlying = ?', date, underlying);
      return r ? (JSON.parse(r.json as string) as unknown) : null;
    },
    async saveWeekly(weekStart, underlying, range) {
      await db.prepare('INSERT OR IGNORE INTO ltp_weekly_range (week_start, underlying, json) VALUES (?, ?, ?)').bind(weekStart, underlying, json(range)).run();
    },
    async getWeekly(weekStart, underlying) {
      const r = await one('SELECT json FROM ltp_weekly_range WHERE week_start = ? AND underlying = ?', weekStart, underlying);
      return r ? (JSON.parse(r.json as string) as unknown) : null;
    },
    async addCalibration(e) {
      await db.prepare('INSERT OR REPLACE INTO ltp_calibration (id, underlying, entry_ts, label, actual, snapshot_ts, proxies_json) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(e.id, e.underlying, e.entryTs, e.label, e.actual, e.snapshotTs, json(e.proxies)).run();
    },
    async calibrationEntries(underlying) {
      const { results } = await db.prepare('SELECT * FROM ltp_calibration WHERE underlying = ? ORDER BY entry_ts ASC').bind(underlying).all<Raw>();
      return results.map((r) => ({ id: r.id as string, underlying: r.underlying as string, entryTs: r.entry_ts as number, label: r.label as string, actual: r.actual as number, snapshotTs: r.snapshot_ts as number, proxies: JSON.parse(r.proxies_json as string) as Record<string, number | null> }));
    },
  };
}
