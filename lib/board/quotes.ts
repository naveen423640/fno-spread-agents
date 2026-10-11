// Batched FYERS quote reads for the board. Read-only: this file only ever calls the quotes endpoint.
import type { SnapshotRow } from './types';

const FYERS_DATA_BASE = 'https://api-t1.fyers.in/data';
const AUTH_CODES = new Set([-8, -15, -16, -17]);

export type QuoteValues = Record<string, number>;
export type QuoteDeps = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };
export type QuoteResult = { quotes: Map<string, QuoteValues>; failedBatches: number; loginRequired: boolean; errors: string[]; rejected: { n: string; message: string }[] };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A failed batch is skipped and reported, never thrown, so one bad request cannot stop the poll loop.
export async function fetchQuotes(credentials: { clientId: string; accessToken: string }, symbols: string[], batchSize: number, gapMs: number, deps: QuoteDeps = {}): Promise<QuoteResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const result: QuoteResult = { quotes: new Map(), failedBatches: 0, loginRequired: false, errors: [], rejected: [] };
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const url = new URL(`${FYERS_DATA_BASE}/quotes`);
    url.searchParams.set('symbols', batch.join(','));
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt += 1) {
      try {
        const response = await fetchImpl(url, { headers: { Authorization: `${credentials.clientId}:${credentials.accessToken}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
        if (response.status === 429) { await sleep(Math.max(Number(response.headers.get('Retry-After') ?? 0) * 1000, 750 * (attempt + 1))); continue; }
        const payload = (await response.json().catch(() => null)) as { s?: string; code?: number; message?: string; d?: { n: string; s: string; v?: QuoteValues & { errmsg?: never }; errmsg?: string }[] } | null;
        if (response.status === 401 || (payload?.code !== undefined && AUTH_CODES.has(payload.code))) { result.loginRequired = true; done = true; result.failedBatches += 1; break; }
        if (!response.ok || !payload || payload.s === 'error') { result.errors.push(payload?.message ?? `quotes request failed (${response.status})`); result.failedBatches += 1; done = true; break; }
        for (const row of payload.d ?? []) {
          if (row.s === 'ok' && row.v) result.quotes.set(row.n, row.v);
          else if (result.rejected.length < 5) result.rejected.push({ n: row.n, message: String(row.errmsg ?? (row.v as { errmsg?: string } | undefined)?.errmsg ?? row.s) });
        }
        done = true;
      } catch {
        if (attempt === 2) { result.errors.push('could not reach FYERS'); result.failedBatches += 1; }
        else await sleep(500 * (attempt + 1));
      }
    }
    if (result.loginRequired) break;
    if (i + batchSize < symbols.length) await sleep(gapMs);
  }
  return result;
}

const n = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const positive = (value: unknown): number | null => { const v = n(value); return v !== null && v > 0 ? v : null; };

// FYERS's prev_close_price is rolled to today's close once the session ends (INFY showed prev_close_price equal to its last price
// with ch +26.4), so the previous close is derived as lp - ch, as the heatmap does. prev_close_price is only a fallback.
// The quotes endpoint carries no open interest, so OI is attached separately from the futures history (see oi.ts).
export function toSnapshotRow(symbol: string, ts: number, v: QuoteValues, oi: { oi: number | null; prevOi: number | null } = { oi: null, prevOi: null }): SnapshotRow | null {
  const ltp = positive(v.lp);
  if (ltp === null) return null;
  const change = n(v.ch);
  return {
    symbol, ts, ltp,
    volume: n(v.volume) ?? n(v.vol_traded_today),
    oi: oi.oi, prevOi: oi.prevOi,
    open: positive(v.open_price), high: positive(v.high_price), low: positive(v.low_price),
    prevClose: (change !== null ? positive(ltp - change) : null) ?? positive(v.prev_close_price),
    vwap: positive(v.atp),
  };
}
