import type { D1Like } from '../agents/store';
import type { Candle } from './types';

// D1 storage for the Screener: a per-symbol candle cache (one JSON row per source and symbol) and background job rows.
// Tables come from drizzle/0003_screener.sql; this store never creates them.

export type JobKind = 'scan' | 'backtest';
export type JobStatus = 'running' | 'done' | 'login_required' | 'failed';
export type JobRow = {
  id: string;
  kind: JobKind;
  source: string;
  params: unknown;
  status: JobStatus;
  progress: number;
  message: string;
  result: unknown;
  createdAt: string;
  completedAt: string | null;
};
// coversFrom is the earliest date the last full request asked for, so a short-history symbol is not refetched every load.
export type CachedCandles = { candles: Candle[]; firstDate: string; lastDate: string; coversFrom: string; refreshedAt: string };

export type ScreenerStore = {
  getCandles(source: string, symbol: string): Promise<CachedCandles | null>;
  saveCandles(source: string, symbol: string, candles: Candle[], coversFrom?: string): Promise<void>;
  createJob(job: { id: string; kind: JobKind; source: string; params: unknown }): Promise<void>;
  updateJob(id: string, patch: { status?: JobStatus; progress?: number; message?: string; result?: unknown }): Promise<void>;
  getJob(id: string): Promise<JobRow | null>;
  latestDone(kind: JobKind, source: string): Promise<JobRow | null>;
  countJobsSince(isoTime: string): Promise<number>;
};

type Raw = Record<string, string | number | null>;
const parse = (text: unknown) => (typeof text === 'string' ? (JSON.parse(text) as unknown) : null);

function toJob(row: Raw): JobRow {
  return {
    id: row.id as string,
    kind: row.kind as JobKind,
    source: row.source as string,
    params: parse(row.params_json),
    status: row.status as JobStatus,
    progress: row.progress as number,
    message: row.message as string,
    result: parse(row.result_json),
    createdAt: row.created_at as string,
    completedAt: row.completed_at as string | null,
  };
}

export function createScreenerStore(db: D1Like, now: () => Date = () => new Date()): ScreenerStore {
  const stamp = () => now().toISOString();
  return {
    async getCandles(source, symbol) {
      const row = await db.prepare('SELECT candles_json, first_date, last_date, covers_from, refreshed_at FROM screener_candles WHERE source = ? AND symbol = ?').bind(source, symbol).first<Raw>();
      if (!row) return null;
      return { candles: JSON.parse(row.candles_json as string) as Candle[], firstDate: row.first_date as string, lastDate: row.last_date as string, coversFrom: row.covers_from as string, refreshedAt: row.refreshed_at as string };
    },
    async saveCandles(source, symbol, candles, coversFrom) {
      if (!candles.length) return;
      const sorted = [...candles].sort((a, b) => a.date.localeCompare(b.date));
      await db.prepare('INSERT INTO screener_candles (source, symbol, candles_json, first_date, last_date, covers_from, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source, symbol) DO UPDATE SET candles_json = excluded.candles_json, first_date = excluded.first_date, last_date = excluded.last_date, covers_from = excluded.covers_from, refreshed_at = excluded.refreshed_at')
        .bind(source, symbol, JSON.stringify(sorted), sorted[0].date, sorted[sorted.length - 1].date, coversFrom ?? sorted[0].date, stamp()).run();
    },
    async createJob(job) {
      await db.prepare('INSERT INTO screener_jobs (id, kind, source, params_json, status, progress, message, result_json, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(job.id, job.kind, job.source, JSON.stringify(job.params), 'running', 0, 'Starting', null, stamp(), null).run();
    },
    async updateJob(id, patch) {
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); if (patch.status !== 'running') { sets.push('completed_at = ?'); values.push(stamp()); } }
      if (patch.progress !== undefined) { sets.push('progress = ?'); values.push(patch.progress); }
      if (patch.message !== undefined) { sets.push('message = ?'); values.push(patch.message); }
      if (patch.result !== undefined) { sets.push('result_json = ?'); values.push(JSON.stringify(patch.result)); }
      if (!sets.length) return;
      await db.prepare(`UPDATE screener_jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
    },
    async getJob(id) {
      const row = await db.prepare('SELECT * FROM screener_jobs WHERE id = ?').bind(id).first<Raw>();
      return row ? toJob(row) : null;
    },
    async latestDone(kind, source) {
      const row = await db.prepare("SELECT * FROM screener_jobs WHERE kind = ? AND source = ? AND status = 'done' ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(kind, source).first<Raw>();
      return row ? toJob(row) : null;
    },
    async countJobsSince(isoTime) {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM screener_jobs WHERE created_at >= ?').bind(isoTime).first<{ n: number }>();
      return row?.n ?? 0;
    },
  };
}
