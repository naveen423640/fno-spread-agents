import { DEFAULT_PARAMS, UNIVERSE, type ScreenerParams } from './config';
import { MIN_TRADES, SOURCES, type ScreenerDeps } from './service';
import type { JobKind, JobRow } from './store';

// Pure helpers behind the /api/screener routes, kept out of the route files so they can be tested.

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export type JobView = Pick<JobRow, 'id' | 'kind' | 'source' | 'params' | 'status' | 'progress' | 'message' | 'result' | 'createdAt' | 'completedAt'>;

export function jobView(job: JobRow): JobView {
  return { id: job.id, kind: job.kind, source: job.source, params: job.params, status: job.status, progress: job.progress, message: job.message, result: job.result, createdAt: job.createdAt, completedAt: job.completedAt };
}

export type LatestView = { status: 'none' } | { status: 'ok'; job: JobView } | { status: 'error'; error: string; httpStatus: 400 };

// The newest finished job of a kind for a source. Reading this never starts any work.
export async function latestView(deps: ScreenerDeps, kind: JobKind, source: unknown): Promise<LatestView> {
  if (typeof source !== 'string' || !(SOURCES as readonly string[]).includes(source)) return { status: 'error', error: 'source must be "fyers", "kite" or "synthetic".', httpStatus: 400 };
  const job = await deps.store.latestDone(kind, source);
  return job ? { status: 'ok', job: jobView(job) } : { status: 'none' };
}

export function parseCheckQuery(params: URLSearchParams) {
  const text = (key: string) => params.get(key) ?? undefined;
  const num = (key: string) => {
    const value = params.get(key);
    return value === null || value === '' ? undefined : Number(value);
  };
  // Parameters arrive as JSON text; text that is not valid JSON is passed on as is so validation rejects it.
  const rawParams = params.get('params');
  let parsedParams: unknown;
  if (rawParams !== null && rawParams !== '') {
    try { parsedParams = JSON.parse(rawParams); } catch { parsedParams = rawParams; }
  }
  return { source: text('source'), symbol: text('symbol'), side: text('side'), kLong: num('kLong'), kShort: num('kShort'), expiry: text('expiry'), debit: num('debit'), lot: num('lot'), params: parsedParams };
}

export function failureStatus(code: string): number {
  switch (code) {
    case 'LOGIN_REQUIRED': return 401;
    case 'NOT_FOUND':
    case 'NO_DATA': return 404;
    case 'BAD_REQUEST': return 400;
    case 'BAD_QUOTES': return 422;
    case 'NOT_CONFIGURED': return 503;
    default: return 502;
  }
}

export type ConfigView = {
  defaults: ScreenerParams;
  sectors: string[];
  universeSize: number;
  sources: { id: string; label: string; available: boolean }[];
  liveBroker: 'fyers' | 'kite';
  minTrades: number;
};

export function buildConfig(options: { liveBroker: 'fyers' | 'kite'; liveConnected: boolean }): ConfigView {
  return {
    defaults: DEFAULT_PARAMS,
    sectors: [...new Set(Object.values(UNIVERSE))].sort(),
    universeSize: Object.keys(UNIVERSE).length,
    sources: [
      { id: 'synthetic', label: 'Synthetic data (dry run)', available: true },
      { id: options.liveBroker, label: options.liveBroker === 'kite' ? 'Kite (live)' : 'FYERS (live)', available: options.liveConnected },
    ],
    liveBroker: options.liveBroker,
    minTrades: MIN_TRADES,
  };
}
