import type { Candle } from './types';

// Assumptions to verify in Task 8 and Task 11: the resolution code and the per-request range limit for daily candles.
export const DAILY_RESOLUTION = 'D';
export const DAILY_CHUNK_DAYS = 360;
const DAY_MS = 86_400_000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function chunkRanges(from: string, to: string, maxDays: number) {
  const chunks: { from: string; to: string }[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let start = new Date(`${from}T00:00:00Z`).getTime(); start <= end; start += maxDays * DAY_MS) {
    chunks.push({ from: isoDate(start), to: isoDate(Math.min(start + (maxDays - 1) * DAY_MS, end)) });
  }
  return chunks;
}

export function epochToIstDate(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// -16 is already used by this app for auth failures; -22 (expired token) and the message text come from FYERS
// community posts. Unverified against real responses here; Task 11 confirms them.
const AUTH_CODES = new Set([-16, -22]);

function isAuthFailure(status: number, payload: { code?: number; message?: string } | null) {
  return status === 401 || (payload?.code !== undefined && AUTH_CODES.has(payload.code)) || /could not authenticate/i.test(payload?.message ?? '');
}

type DailyResult = { ok: true; candles: Candle[] } | { ok: false; status: 401 | 502; message: string };

export async function fetchDailyCandles(credentials: { clientId: string; accessToken: string }, symbol: string, from: string, to: string, fetchImpl: typeof fetch = fetch): Promise<DailyResult> {
  const byDate = new Map<string, number>();
  for (const range of chunkRanges(from, to, DAILY_CHUNK_DAYS)) {
    const url = new URL('https://api-t1.fyers.in/data/history');
    for (const [key, value] of Object.entries({ symbol, resolution: DAILY_RESOLUTION, date_format: '1', range_from: range.from, range_to: range.to, cont_flag: '1' })) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Authorization: `${credentials.clientId}:${credentials.accessToken}`, Accept: 'application/json' }, cache: 'no-store' });
    } catch {
      // Fixed text on purpose: the underlying error can include request details, and the token must never be echoed.
      return { ok: false, status: 502, message: 'Could not reach FYERS. Try again shortly.' };
    }
    const payload = await response.json().catch(() => null) as { s?: string; code?: number; message?: string; candles?: number[][] } | null;
    if (isAuthFailure(response.status, payload)) return { ok: false, status: 401, message: payload?.message ?? 'FYERS rejected the access token.' };
    if (!response.ok || payload?.s !== 'ok' || !Array.isArray(payload.candles)) return { ok: false, status: 502, message: payload?.message ?? `FYERS history failed (${response.status}).` };
    for (const candle of payload.candles) byDate.set(epochToIstDate(candle[0]), candle[4]);
  }
  return { ok: true, candles: [...byDate.entries()].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date)) };
}
