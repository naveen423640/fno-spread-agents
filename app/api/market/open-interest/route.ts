import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { marketSnapshot } from '@/lib/market-snapshot';

type OptionLeg = {
  option_type?: string;
  strike_price?: number | string;
  oi?: number | string;
  oich?: number | string;
  prev_oi?: number | string;
  ltp?: number | string;
};

type Expiry = { date?: string; expiry?: string | number; expiry_flag?: string };
type OpenInterestPoint = {
  strike: number;
  callOi: number;
  putOi: number;
  callOiChange: number;
  putOiChange: number;
  callPreviousOi: number;
  putPreviousOi: number;
};
type OpenInterestPayload = {
  points: OpenInterestPoint[];
  spot: number;
  atmStrike: number;
  expiry: string;
  expiryTimestamp?: string;
  totalCallOi: number;
  totalPutOi: number;
  source: string;
  asOf: string;
};

const optionChainCache = new Map<string, { expiresAt: number; promise: Promise<OpenInterestPayload> }>();

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadOpenInterest(
  credentials: { clientId: string; accessToken: string },
  symbol: string,
): Promise<OpenInterestPayload> {
  const url = new URL('https://api-t1.fyers.in/data/options-chain-v3');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('strikecount', '10');

  const response = await fetch(url, {
    headers: { Authorization: `${credentials.clientId}:${credentials.accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as {
    s?: string;
    code?: number;
    message?: string;
    data?: {
      optionsChain?: OptionLeg[];
      expiryData?: Expiry[];
      callOi?: number | string;
      putOi?: number | string;
    };
  } | null;

  const chain = payload?.data?.optionsChain;
  if (!response.ok || payload?.s !== 'ok' || !Array.isArray(chain)) {
    throw new Error(payload?.message ?? `FYERS option-chain request failed (${response.status}).`);
  }

  const spotRow = chain.find((leg) => !leg.option_type || numeric(leg.strike_price, -1) < 0);
  const spot = numeric(spotRow?.ltp);
  const strikes = new Map<number, OpenInterestPoint>();
  for (const leg of chain) {
    const optionType = leg.option_type?.toUpperCase();
    const strike = numeric(leg.strike_price, Number.NaN);
    if ((optionType !== 'CE' && optionType !== 'PE') || !Number.isFinite(strike) || strike <= 0) continue;
    const row = strikes.get(strike) ?? {
      strike,
      callOi: 0,
      putOi: 0,
      callOiChange: 0,
      putOiChange: 0,
      callPreviousOi: 0,
      putPreviousOi: 0,
    };
    const oi = Math.max(0, numeric(leg.oi));
    const change = numeric(leg.oich);
    const previous = Math.max(0, numeric(leg.prev_oi, oi - change));
    if (optionType === 'CE') {
      row.callOi = oi;
      row.callOiChange = change;
      row.callPreviousOi = previous;
    } else {
      row.putOi = oi;
      row.putOiChange = change;
      row.putPreviousOi = previous;
    }
    strikes.set(strike, row);
  }

  const points = [...strikes.values()].sort((a, b) => a.strike - b.strike);
  if (!points.length) throw new Error('FYERS returned no option strikes for this stock. It may not have an active option contract.');
  const atmStrike = points.reduce((nearest, point) => (
    Math.abs(point.strike - spot) < Math.abs(nearest - spot) ? point.strike : nearest
  ), points[0].strike);
  const expiry = payload.data?.expiryData?.[0];
  const summedCallOi = points.reduce((sum, point) => sum + point.callOi, 0);
  const summedPutOi = points.reduce((sum, point) => sum + point.putOi, 0);

  return {
    points,
    spot,
    atmStrike,
    expiry: expiry?.date ?? 'Nearest expiry',
    expiryTimestamp: expiry?.expiry !== undefined ? String(expiry.expiry) : undefined,
    totalCallOi: numeric(payload.data?.callOi, summedCallOi),
    totalPutOi: numeric(payload.data?.putOi, summedPutOi),
    source: 'FYERS live option chain',
    asOf: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol') ?? '';
  if (!marketSnapshot.some((stock) => stock.symbol === symbol)) {
    return Response.json({ error: 'Choose a stock from the F&O heat map.' }, { status: 400 });
  }
  const credentials = fyersCredentials(request);
  if (!credentials) {
    return Response.json({ error: 'Connect FYERS to load live open interest.' }, { status: 401 });
  }

  const key = `${credentials.clientId}:${credentials.accessToken}:${symbol}`;
  const cached = optionChainCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    try {
      return Response.json(await cached.promise, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      optionChainCache.delete(key);
    }
  }

  const promise = loadOpenInterest(credentials, symbol);
  optionChainCache.set(key, { expiresAt: Date.now() + 150_000, promise });
  if (optionChainCache.size > 100) optionChainCache.delete(optionChainCache.keys().next().value as string);
  try {
    return Response.json(await promise, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    optionChainCache.delete(key);
    const message = error instanceof Error ? error.message : 'Unable to load FYERS open interest.';
    const unauthorized = /token|auth|login|unauthor/i.test(message);
    return Response.json({ error: message }, { status: unauthorized ? 401 : 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
