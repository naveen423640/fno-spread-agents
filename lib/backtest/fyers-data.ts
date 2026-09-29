import type { FyersHistory } from './types';

export function fyersCredentials(request: Request) {
  const cookies = request.headers.get('cookie') ?? '';
  const cookie = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith('fyers_access_token='));
  const accessToken = cookie ? decodeURIComponent(cookie.slice('fyers_access_token='.length)) : process.env.FYERS_ACCESS_TOKEN;
  const clientId = process.env.FYERS_CLIENT_ID;
  return clientId && accessToken ? { clientId, accessToken } : null;
}

export async function getFyersHistory(credentials: { clientId: string; accessToken: string }, symbol: string, rangeFrom: string, rangeTo: string): Promise<FyersHistory> {
  const url = new URL('https://api-t1.fyers.in/data/history');
  for (const [key, value] of Object.entries({ symbol, resolution: '1', date_format: '1', range_from: rangeFrom, range_to: rangeTo, cont_flag: '1' })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `${credentials.clientId}:${credentials.accessToken}`, Accept: 'application/json' }, cache: 'no-store' });
  const payload = await response.json() as { s?: string; code?: number; message?: string; candles?: number[][] };
  return { ok: response.ok && payload.s === 'ok' && Array.isArray(payload.candles), candles: payload.candles ?? [], code: payload.code, message: payload.message };
}

export function findEntryCandle(candles: number[][], entryTimestamp: string) {
  const targetSeconds = Math.floor(new Date(entryTimestamp).getTime() / 1000);
  return candles.find((candle) => candle[0] === targetSeconds) ?? null;
}
