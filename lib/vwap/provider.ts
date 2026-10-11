// Where 5-minute candles come from. The scanner and backtest only see this interface, so another broker (Kite) can be added later.
import { parseIntradayCandles } from '../board/candles';
import type { C5 } from './core';

const FYERS_DATA_BASE = 'https://api-t1.fyers.in/data';
const AUTH_CODES = new Set([-8, -15, -16, -17]);
export const MAX_DAYS_PER_REQUEST = 100; // FYERS rejects a longer intraday range ("Invalid input"), measured on 12 Oct 2026

export type ProviderResult<T> = { ok: true; value: T } | { ok: false; code: 'LOGIN_REQUIRED' | 'UPSTREAM' | 'NO_DATA'; message: string };

export interface DataProvider {
  readonly name: string;
  // 5-minute candles for every session from fromDay to toDay inclusive (IST dates, YYYY-MM-DD), oldest first.
  candles5m(symbol: string, fromDay: string, toDay: string): Promise<ProviderResult<C5[]>>;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Splits [from, to] into ranges of at most `maxDays` calendar days.
export function chunkDays(fromDay: string, toDay: string, maxDays = MAX_DAYS_PER_REQUEST): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let from = fromDay;
  while (from <= toDay) {
    const to = addDays(from, maxDays - 1) < toDay ? addDays(from, maxDays - 1) : toDay;
    out.push({ from, to });
    from = addDays(to, 1);
  }
  return out;
}

// Spaces calls out so a burst of parallel workers stays under the request limit (about 10 per second per FYERS's documentation).
export function createRateLimiter(perSecond: number, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const gap = 1000 / perSecond;
  let next = 0;
  return async () => {
    const at = Math.max(now(), next);
    next = at + gap;
    const wait = at - now();
    if (wait > 0) await sleep(wait);
  };
}

export type FyersProviderDeps = { credentials: { clientId: string; accessToken: string }; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; limiter?: () => Promise<void>; maxAttempts?: number };

export function createFyersProvider(deps: FyersProviderDeps): DataProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limiter = deps.limiter ?? createRateLimiter(8);
  const attempts = deps.maxAttempts ?? 4;

  async function one(symbol: string, from: string, to: string): Promise<ProviderResult<C5[]>> {
    const url = new URL(`${FYERS_DATA_BASE}/history`);
    for (const [key, value] of Object.entries({ symbol, resolution: '5', date_format: '1', range_from: from, range_to: to, cont_flag: '1' })) url.searchParams.set(key, value);
    let lastMessage = 'request failed';
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await limiter();
      try {
        const response = await fetchImpl(url, { headers: { Authorization: `${deps.credentials.clientId}:${deps.credentials.accessToken}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
        const payload = (await response.json().catch(() => null)) as { s?: string; code?: number; message?: string; candles?: unknown } | null;
        if (response.status === 401 || (payload?.code !== undefined && AUTH_CODES.has(payload.code))) return { ok: false, code: 'LOGIN_REQUIRED', message: 'The FYERS login has expired. Sign in again.' };
        if (response.status === 429 || response.status >= 500) { lastMessage = `FYERS returned ${response.status}`; await sleep(Math.max(Number(response.headers.get('Retry-After') ?? 0) * 1000, 600 * 2 ** attempt)); continue; }
        // FYERS answers "no data" for a range with no sessions (holidays, weekends) with an error status or an empty list.
        if (payload?.s === 'no_data' || (payload?.s === 'ok' && Array.isArray(payload.candles) && payload.candles.length === 0)) return { ok: true, value: [] };
        if (!response.ok || !payload || payload.s !== 'ok') return { ok: false, code: 'UPSTREAM', message: payload?.message ?? `history failed (${response.status})` };
        return { ok: true, value: parseIntradayCandles(payload.candles) };
      } catch {
        lastMessage = 'could not reach FYERS';
        await sleep(600 * 2 ** attempt);
      }
    }
    return { ok: false, code: 'UPSTREAM', message: lastMessage };
  }

  return {
    name: 'fyers',
    async candles5m(symbol, fromDay, toDay) {
      const all: C5[] = [];
      for (const range of chunkDays(fromDay, toDay)) {
        const result = await one(symbol, range.from, range.to);
        if (!result.ok) return result;
        all.push(...result.value);
      }
      const seen = new Set<number>();
      return { ok: true, value: all.filter((c) => (seen.has(c.t) ? false : (seen.add(c.t), true))).sort((a, b) => a.t - b.t) };
    },
  };
}
