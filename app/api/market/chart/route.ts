import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { marketSnapshot } from '@/lib/market-snapshot';

type IntradayPoint = {
  timestamp: number;
  sessionDate: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartPayload = { points: IntradayPoint[]; sessions: string[]; date: string; interval: string; source: string; asOf: string };
type ChartRange = '1d' | '2d' | '1w' | '1m';

const chartRanges: Record<ChartRange, { sessions: number; calendarDays: number }> = {
  '1d': { sessions: 1, calendarDays: 4 },
  '2d': { sessions: 2, calendarDays: 8 },
  '1w': { sessions: 5, calendarDays: 14 },
  '1m': { sessions: 22, calendarDays: 45 },
};
const chartCache = new Map<string, { expiresAt: number; promise: Promise<ChartPayload> }>();

function indiaDateFor(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function indiaDate() {
  return indiaDateFor(new Date());
}

function offsetDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function loadChart(credentials: { clientId: string; accessToken: string }, symbol: string, date: string, range: ChartRange): Promise<ChartPayload> {
  const rangeConfig = chartRanges[range];
  const url = new URL('https://api-t1.fyers.in/data/history');
  for (const [key, value] of Object.entries({
    symbol,
    resolution: '5',
    date_format: '1',
    range_from: offsetDate(date, -rangeConfig.calendarDays),
    range_to: date,
    cont_flag: '1',
  })) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Authorization: `${credentials.clientId}:${credentials.accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { s?: string; code?: number; message?: string; candles?: number[][] } | null;
  if (!response.ok || payload?.s !== 'ok' || !Array.isArray(payload.candles)) {
    throw new Error(payload?.message ?? `FYERS chart request failed (${response.status}).`);
  }

  const timeFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const allPoints = payload.candles.flatMap((candle): IntradayPoint[] => {
    const [timestamp, open, high, low, close, volume] = candle.map(Number);
    if (![timestamp, open, high, low, close].every(Number.isFinite)) return [];
    const instant = new Date(timestamp * 1_000);
    return [{ timestamp, sessionDate: indiaDateFor(instant), time: timeFormatter.format(instant), open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 }];
  });
  const sessions = [...new Set(allPoints.map((point) => point.sessionDate).filter((sessionDate) => sessionDate <= date))].sort().slice(-rangeConfig.sessions);
  const sessionSet = new Set(sessions);
  const points = allPoints.filter((point) => sessionSet.has(point.sessionDate)).sort((a, b) => a.timestamp - b.timestamp);
  if (!points.length) throw new Error('No intraday candles are available for this stock and date.');
  return { points, sessions, date, interval: '5 min', source: 'FYERS historical candles', asOf: new Date().toISOString() };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol') ?? '';
  const requestedDate = url.searchParams.get('date') ?? 'live';
  const requestedRange = url.searchParams.get('range') ?? '2d';
  if (!marketSnapshot.some((stock) => stock.symbol === symbol)) {
    return Response.json({ error: 'Choose a stock from the F&O heat map.' }, { status: 400 });
  }
  if (requestedDate !== 'live' && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return Response.json({ error: 'Choose a valid trading date.' }, { status: 400 });
  }
  if (!(requestedRange in chartRanges)) {
    return Response.json({ error: 'Choose a valid chart range.' }, { status: 400 });
  }
  const credentials = fyersCredentials(request);
  if (!credentials) {
    return Response.json({ error: 'Connect FYERS to load the intraday price chart.' }, { status: 401 });
  }

  const date = requestedDate === 'live' ? indiaDate() : requestedDate;
  const range = requestedRange as ChartRange;
  const key = `${credentials.clientId}:${credentials.accessToken}:${symbol}:${date}:${range}`;
  const cached = chartCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    try {
      return Response.json(await cached.promise, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      chartCache.delete(key);
    }
  }

  const promise = loadChart(credentials, symbol, date, range);
  chartCache.set(key, { expiresAt: Date.now() + (requestedDate === 'live' ? 60_000 : 3_600_000), promise });
  if (chartCache.size > 100) chartCache.delete(chartCache.keys().next().value as string);
  try {
    return Response.json(await promise, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    chartCache.delete(key);
    const message = error instanceof Error ? error.message : 'Unable to load the FYERS chart.';
    return Response.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
