import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { marketSnapshot } from '@/lib/market-snapshot';

type ResponsesPayload = { output?: unknown[]; error?: { message?: string } };
type FunctionCall = { type: 'function_call'; name: string; call_id: string; arguments: string };

export const fyersMarketDataTool = {
  type: 'function',
  name: 'get_fyers_market_data',
  description: 'Fetch the latest FYERS equity quote and, when requested, the nearest-expiry option chain with strike premiums and open interest for one ticker in the app universe. Use this for current price, day OHLC, volume, option premium, OI, PCR, support/resistance from OI, or option-based screening. The app executes this function; never invent its output.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      ticker: { type: 'string', description: 'Exact NSE F&O ticker from the supplied app universe.' },
      include_options: { type: 'boolean', description: 'True when option-chain, premium, strike, expiry, PCR, or open-interest data is needed.' },
    },
    required: ['ticker', 'include_options'],
    additionalProperties: false,
  },
} as const;

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadQuote(credentials: { clientId: string; accessToken: string }, symbol: string) {
  const url = new URL('https://api-t1.fyers.in/data/quotes');
  url.searchParams.set('symbols', symbol);
  const response = await fetch(url, {
    headers: { Authorization: `${credentials.clientId}:${credentials.accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { s?: string; code?: number; message?: string; d?: Array<{ n?: string; s?: string; v?: Record<string, unknown> }> } | null;
  const row = payload?.d?.find((item) => item.n === symbol) ?? payload?.d?.[0];
  if (!response.ok || payload?.s === 'error' || row?.s !== 'ok' || !row.v) {
    throw new Error(payload?.message ?? `FYERS quote request failed (${response.status}).`);
  }
  const price = numeric(row.v.lp);
  const change = numeric(row.v.ch);
  return {
    price,
    change,
    changePct: numeric(row.v.chp),
    previousClose: price - change,
    open: numeric(row.v.open_price ?? row.v.open),
    high: numeric(row.v.high_price ?? row.v.high),
    low: numeric(row.v.low_price ?? row.v.low),
    volume: numeric(row.v.volume),
  };
}

async function loadOptionChain(credentials: { clientId: string; accessToken: string }, symbol: string) {
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
    message?: string;
    data?: {
      optionsChain?: Array<{ option_type?: string; strike_price?: number | string; oi?: number | string; oich?: number | string; prev_oi?: number | string; ltp?: number | string; volume?: number | string; iv?: number | string }>;
      expiryData?: Array<{ date?: string; expiry?: string | number }>;
      callOi?: number | string;
      putOi?: number | string;
    };
  } | null;
  const chain = payload?.data?.optionsChain;
  if (!response.ok || payload?.s !== 'ok' || !Array.isArray(chain)) {
    throw new Error(payload?.message ?? `FYERS option-chain request failed (${response.status}).`);
  }
  const spot = numeric(chain.find((leg) => !leg.option_type || numeric(leg.strike_price, -1) < 0)?.ltp);
  const strikes = new Map<number, {
    strike: number;
    call: { ltp: number; oi: number; oiChange: number; previousOi: number; volume: number; iv: number } | null;
    put: { ltp: number; oi: number; oiChange: number; previousOi: number; volume: number; iv: number } | null;
  }>();
  for (const leg of chain) {
    const optionType = leg.option_type?.toUpperCase();
    const strike = numeric(leg.strike_price, Number.NaN);
    if ((optionType !== 'CE' && optionType !== 'PE') || !Number.isFinite(strike) || strike <= 0) continue;
    const row = strikes.get(strike) ?? { strike, call: null, put: null };
    const oi = Math.max(0, numeric(leg.oi));
    const oiChange = numeric(leg.oich);
    const option = {
      ltp: numeric(leg.ltp),
      oi,
      oiChange,
      previousOi: Math.max(0, numeric(leg.prev_oi, oi - oiChange)),
      volume: numeric(leg.volume),
      iv: numeric(leg.iv),
    };
    if (optionType === 'CE') row.call = option;
    else row.put = option;
    strikes.set(strike, row);
  }
  const rows = [...strikes.values()].sort((a, b) => a.strike - b.strike);
  if (!rows.length) throw new Error('FYERS returned no active option strikes for this stock.');
  const summedCallOi = rows.reduce((sum, row) => sum + (row.call?.oi ?? 0), 0);
  const summedPutOi = rows.reduce((sum, row) => sum + (row.put?.oi ?? 0), 0);
  const totalCallOi = numeric(payload.data?.callOi, summedCallOi);
  const totalPutOi = numeric(payload.data?.putOi, summedPutOi);
  return {
    expiry: payload.data?.expiryData?.[0]?.date ?? 'Nearest expiry',
    expiryTimestamp: payload.data?.expiryData?.[0]?.expiry !== undefined ? String(payload.data.expiryData[0].expiry) : undefined,
    spot,
    atmStrike: rows.reduce((nearest, row) => Math.abs(row.strike - spot) < Math.abs(nearest - spot) ? row.strike : nearest, rows[0].strike),
    totalCallOi,
    totalPutOi,
    pcr: totalCallOi > 0 ? totalPutOi / totalCallOi : null,
    strikes: rows,
  };
}

async function executeTool(request: Request, call: FunctionCall, allowedTickers: Set<string>) {
  if (call.name !== fyersMarketDataTool.name) return { error: 'Unsupported data tool.' };
  let args: { ticker?: string; include_options?: boolean } = {};
  try {
    args = JSON.parse(call.arguments) as typeof args;
  } catch {
    return { error: 'Invalid FYERS tool arguments.' };
  }
  const ticker = args.ticker?.trim().toUpperCase() ?? '';
  const stock = marketSnapshot.find((candidate) => candidate.ticker === ticker);
  if (!stock || !allowedTickers.has(ticker)) return { error: `${ticker || 'Ticker'} is not available in the supplied F&O universe.` };
  const credentials = fyersCredentials(request);
  if (!credentials) return { ticker, error: 'FYERS is not connected for this browser session. Ask the user to click Connect FYERS and retry.' };
  try {
    const [quote, options] = await Promise.all([
      loadQuote(credentials, stock.symbol),
      args.include_options ? loadOptionChain(credentials, stock.symbol) : Promise.resolve(null),
    ]);
    return {
      provider: 'FYERS',
      asOf: new Date().toISOString(),
      ticker,
      company: stock.name,
      symbol: stock.symbol,
      quote,
      options,
      optionDataNote: options ? 'Nearest-expiry live option chain around ATM; strike count is limited.' : undefined,
    };
  } catch (error) {
    return { ticker, provider: 'FYERS', error: error instanceof Error ? error.message : 'FYERS data request failed.' };
  }
}

export async function createResponseWithFyersTools({
  request,
  apiKey,
  allowedTickers,
  body,
}: {
  request: Request;
  apiKey: string;
  allowedTickers: Set<string>;
  body: Record<string, unknown> & { input: unknown[] };
}) {
  let input = body.input;
  let toolCalls = 0;
  const sourceItems: unknown[] = [];

  for (let turn = 0; turn < 3; turn += 1) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, input }),
      signal: AbortSignal.timeout(55_000),
    });
    const payload = await response.json().catch(() => null) as ResponsesPayload | null;
    if (!response.ok) throw new Error(payload?.error?.message ?? `AI request failed (${response.status}).`);
    const output = Array.isArray(payload?.output) ? payload.output : [];
    sourceItems.push(...output.filter((item) => item && typeof item === 'object' && 'type' in item && item.type === 'web_search_call'));
    const calls = output.filter((item): item is FunctionCall => Boolean(
      item && typeof item === 'object' && 'type' in item && item.type === 'function_call' &&
      'name' in item && typeof item.name === 'string' && 'call_id' in item && typeof item.call_id === 'string' &&
      'arguments' in item && typeof item.arguments === 'string',
    ));
    if (!calls.length) return { output: [...sourceItems, ...output.filter((item) => !(item && typeof item === 'object' && 'type' in item && item.type === 'web_search_call'))] };

    const callOutputs = await Promise.all(calls.map(async (call) => {
      toolCalls += 1;
      const result = toolCalls <= 6
        ? await executeTool(request, call, allowedTickers)
        : { error: 'FYERS lookup limit reached. Use the available results and narrow the requested screen.' };
      return { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) };
    }));
    input = [...input, ...output, ...callOutputs];
  }
  throw new Error('The analyst requested too many FYERS lookups. Please ask a narrower question.');
}
