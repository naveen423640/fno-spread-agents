// 5-minute candles for the detail chart: FYERS intraday history first, or candles built from the stored minute snapshots.
import type { C5 } from './zones';
import type { StoredSnapshot } from './store';

const FYERS_DATA_BASE = 'https://api-t1.fyers.in/data';
const AUTH_CODES = new Set([-8, -15, -16, -17]);

export type CandleResult = { ok: true; candles: C5[] } | { ok: false; loginRequired: boolean; message: string };

const dayString = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function parseIntradayCandles(rows: unknown): C5[] {
  if (!Array.isArray(rows)) return [];
  const out: C5[] = [];
  for (const row of rows as number[][]) {
    if (!Array.isArray(row) || row.length < 6 || !row.slice(0, 5).every((v) => Number.isFinite(v))) continue;
    out.push({ t: row[0], o: row[1], h: row[2], l: row[3], c: row[4], v: Number.isFinite(row[5]) ? row[5] : 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

export async function fetchIntradayHistory(credentials: { clientId: string; accessToken: string }, symbol: string, resolution: string, calendarDays: number, now: Date, deps: { fetchImpl?: typeof fetch } = {}): Promise<CandleResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = new URL(`${FYERS_DATA_BASE}/history`);
  const to = dayString(now.getTime());
  const from = dayString(now.getTime() - calendarDays * 86_400_000);
  for (const [key, value] of Object.entries({ symbol, resolution, date_format: '1', range_from: from, range_to: to, cont_flag: '1' })) url.searchParams.set(key, value);
  try {
    const response = await fetchImpl(url, { headers: { Authorization: `${credentials.clientId}:${credentials.accessToken}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    const payload = (await response.json().catch(() => null)) as { s?: string; code?: number; message?: string; candles?: unknown } | null;
    if (response.status === 401 || (payload?.code !== undefined && AUTH_CODES.has(payload.code))) return { ok: false, loginRequired: true, message: 'login required' };
    if (!response.ok || !payload || payload.s !== 'ok') return { ok: false, loginRequired: false, message: payload?.message ?? `history failed (${response.status})` };
    const candles = parseIntradayCandles(payload.candles);
    return candles.length ? { ok: true, candles } : { ok: false, loginRequired: false, message: 'no intraday candles returned' };
  } catch {
    return { ok: false, loginRequired: false, message: 'could not reach FYERS' };
  }
}

// Builds 5-minute candles from the per-minute last-traded-price snapshots. Highs and lows only see the sampled minutes, so they are
// narrower than real candles; volume is the rise in cumulative volume across the bucket.
export function candlesFromSnapshots(rows: StoredSnapshot[], bucketSeconds = 300): C5[] {
  const sorted = [...rows].sort((a, b) => a.ts - b.ts);
  const buckets = new Map<number, C5>();
  let previousVolume: number | null = null;
  for (const r of sorted) {
    const key = Math.floor(r.ts / bucketSeconds) * bucketSeconds;
    const volumeStep = r.volume !== null && previousVolume !== null ? Math.max(0, r.volume - previousVolume) : 0;
    if (r.volume !== null) previousVolume = r.volume;
    const b = buckets.get(key);
    if (!b) buckets.set(key, { t: key, o: r.ltp, h: r.ltp, l: r.ltp, c: r.ltp, v: volumeStep });
    else { b.h = Math.max(b.h, r.ltp); b.l = Math.min(b.l, r.ltp); b.c = r.ltp; b.v += volumeStep; }
  }
  return [...buckets.values()];
}
