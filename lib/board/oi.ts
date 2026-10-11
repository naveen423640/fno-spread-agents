// Futures open interest from FYERS daily history with oi_flag=1 (the quotes endpoint carries no OI). Read-only.
const FYERS_DATA_BASE = 'https://api-t1.fyers.in/data';

export type OiReading = { oi: number; prevOi: number | null; asOfDay: string };
export type OiResult = { ok: true; value: OiReading } | { ok: false; loginRequired: boolean; message: string; shape?: unknown };

const istDayOf = (epochSeconds: number) => new Date(epochSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// Candle rows are [time, open, high, low, close, volume, oi]. The last row is the latest session (the one still forming while
// the market is open) and the row before it gives the previous day's OI.
export function parseOiCandles(candles: unknown): OiResult {
  if (!Array.isArray(candles) || candles.length === 0) return { ok: false, loginRequired: false, message: 'no candles' };
  const rows = candles as number[][];
  const last = rows[rows.length - 1];
  if (!Array.isArray(last) || last.length < 7 || !Number.isFinite(last[6])) return { ok: false, loginRequired: false, message: 'candles carried no OI column', shape: last };
  const before = rows.length > 1 ? rows[rows.length - 2] : null;
  const prevOi = before && before.length >= 7 && Number.isFinite(before[6]) && before[6] > 0 ? before[6] : null;
  return { ok: true, value: { oi: last[6], prevOi, asOfDay: istDayOf(last[0]) } };
}

export async function fetchFuturesOi(credentials: { clientId: string; accessToken: string }, symbol: string, day: string, deps: { fetchImpl?: typeof fetch } = {}): Promise<OiResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - 10 * 86_400_000).toISOString().slice(0, 10);
  const url = new URL(`${FYERS_DATA_BASE}/history`);
  for (const [key, value] of Object.entries({ symbol, resolution: 'D', date_format: '1', range_from: from, range_to: day, cont_flag: '1', oi_flag: '1' })) url.searchParams.set(key, value);
  try {
    const response = await fetchImpl(url, { headers: { Authorization: `${credentials.clientId}:${credentials.accessToken}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    const payload = (await response.json().catch(() => null)) as { s?: string; code?: number; message?: string; candles?: unknown } | null;
    if (response.status === 401 || (payload?.code !== undefined && [-8, -15, -16, -17].includes(payload.code))) return { ok: false, loginRequired: true, message: 'login required' };
    if (!response.ok || !payload || payload.s !== 'ok') return { ok: false, loginRequired: false, message: payload?.message ?? `history failed (${response.status})` };
    return parseOiCandles(payload.candles);
  } catch {
    return { ok: false, loginRequired: false, message: 'could not reach FYERS' };
  }
}

// The whole daily OI series for a future: [IST date, OI] pairs, oldest first. Used by the backtest.
export async function fetchFuturesOiSeries(credentials: { clientId: string; accessToken: string }, symbol: string, fromDay: string, toDay: string, deps: { fetchImpl?: typeof fetch } = {}): Promise<{ ok: true; series: [string, number][] } | { ok: false; loginRequired: boolean; message: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = new URL(`${FYERS_DATA_BASE}/history`);
  for (const [key, value] of Object.entries({ symbol, resolution: 'D', date_format: '1', range_from: fromDay, range_to: toDay, cont_flag: '1', oi_flag: '1' })) url.searchParams.set(key, value);
  try {
    const response = await fetchImpl(url, { headers: { Authorization: `${credentials.clientId}:${credentials.accessToken}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    const payload = (await response.json().catch(() => null)) as { s?: string; code?: number; message?: string; candles?: unknown } | null;
    if (response.status === 401 || (payload?.code !== undefined && [-8, -15, -16, -17].includes(payload.code))) return { ok: false, loginRequired: true, message: 'login required' };
    if (!response.ok || !payload || payload.s !== 'ok' || !Array.isArray(payload.candles)) return { ok: false, loginRequired: false, message: payload?.message ?? `history failed (${response.status})` };
    const series: [string, number][] = [];
    for (const row of payload.candles as number[][]) if (Array.isArray(row) && row.length >= 7 && Number.isFinite(row[6]) && row[6] > 0) series.push([istDayOf(row[0]), row[6]]);
    return series.length ? { ok: true, series } : { ok: false, loginRequired: false, message: 'candles carried no OI column' };
  } catch {
    return { ok: false, loginRequired: false, message: 'could not reach FYERS' };
  }
}
