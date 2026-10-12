import { epochToIstDate } from '../../regime/fyers-daily';
import { expiryParts, fyersEquity, fyersIndex, fyersOption } from '../symbols';
import type { BrokerResult, Candle, Quote } from '../types';
import { chunkRange, defaultSleep, finiteOrNull, LOGIN_MESSAGE, type BrokerAdapter, type DateRange, type OptionKind } from './types';

// Fyers read-only market data: history, quotes, options-chain-v3 and the public symbol master. Written from the FYERS API
// documentation and the reference script; the response shapes are NOT verified against live responses in the unit tests.
const BASE = 'https://api-t1.fyers.in';
const MASTER_URL = 'https://public.fyers.in/sym_details/NSE_FO.csv';
const HISTORY_CHUNK_DAYS = 360;
const HISTORY_THROTTLE_MS = 400;
const MASTER_TTL_MS = 86_400_000;

// Documented FYERS auth failures (codes -8, -15, -16, -17 and HTTP 401), plus the message FYERS uses for a bad token.
const AUTH_CODES = new Set([-8, -15, -16, -17]);
const AUTH_MESSAGE = /could not authenticate|invalid (access )?token|token (is )?expired/i;

export type FyersDeps = {
  credentials: { clientId: string; accessToken: string };
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type Payload = { s?: string; code?: number; message?: string; [key: string]: unknown };

// The read-only broker interface plus the full option chain (used by the LTP Levels recorder).
export type FyersAdapter = BrokerAdapter & { optionChain(underlying: string, strikecount?: number): Promise<BrokerResult<Payload>> };

export function createFyersAdapter(deps: FyersDeps): FyersAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const authorization = `${deps.credentials.clientId}:${deps.credentials.accessToken}`;
  let master: { text: string; at: number } | null = null;

  async function call(url: URL): Promise<BrokerResult<Payload>> {
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Authorization: authorization, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    } catch {
      // Fixed text on purpose: the underlying error can include request details, and the token must never be echoed.
      return { ok: false, code: 'UPSTREAM', message: 'Could not reach FYERS. Try again shortly.' };
    }
    const payload = (await response.json().catch(() => null)) as Payload | null;
    if (response.status === 401 || (payload?.code !== undefined && AUTH_CODES.has(payload.code)) || AUTH_MESSAGE.test(payload?.message ?? '')) {
      return { ok: false, code: 'LOGIN_REQUIRED', message: LOGIN_MESSAGE };
    }
    if (!response.ok || !payload || payload.s === 'error') return { ok: false, code: 'UPSTREAM', message: payload?.message ?? `FYERS request failed (${response.status}).` };
    return { ok: true, value: payload };
  }

  async function history(symbol: string, range: DateRange): Promise<BrokerResult<Candle[]>> {
    const byDate = new Map<string, Candle>();
    const chunks = chunkRange(range, HISTORY_CHUNK_DAYS);
    for (let k = 0; k < chunks.length; k += 1) {
      const url = new URL(`${BASE}/data/history`);
      for (const [key, value] of Object.entries({ symbol, resolution: 'D', date_format: '1', range_from: chunks[k].from, range_to: chunks[k].to, cont_flag: '1' })) url.searchParams.set(key, value);
      const result = await call(url);
      if (!result.ok) return result;
      const rows = result.value.candles;
      if (!Array.isArray(rows)) return { ok: false, code: 'UPSTREAM', message: `FYERS returned no candle list for ${symbol}.` };
      for (const row of rows as number[][]) byDate.set(epochToIstDate(row[0]), { date: epochToIstDate(row[0]), open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] });
      // Pause after every call, including the last, so consecutive symbols also stay under the request limit.
      await sleep(HISTORY_THROTTLE_MS);
    }
    if (!byDate.size) return { ok: false, code: 'UPSTREAM', message: `FYERS returned no candles for ${symbol}.` };
    return { ok: true, value: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  }

  async function quote(symbol: string): Promise<BrokerResult<Quote>> {
    const url = new URL(`${BASE}/data/quotes`);
    url.searchParams.set('symbols', symbol);
    const result = await call(url);
    if (!result.ok) return result;
    const rows = Array.isArray(result.value.d) ? (result.value.d as { n?: string; s?: string; v?: Record<string, unknown> }[]) : [];
    const row = rows.find((item) => item.n === symbol) ?? rows[0];
    if (!row || row.s !== 'ok' || !row.v) return { ok: false, code: 'NOT_FOUND', message: `No quote for ${symbol}. Check that the strike and expiry exist on FYERS.` };
    return { ok: true, value: { bid: finiteOrNull(row.v.bid), ask: finiteOrNull(row.v.ask), ltp: finiteOrNull(row.v.lp), oi: finiteOrNull(row.v.oi) } };
  }

  async function loadMaster(): Promise<BrokerResult<string>> {
    if (master && now() - master.at < MASTER_TTL_MS) return { ok: true, value: master.text };
    let response: Response;
    try {
      response = await fetchImpl(MASTER_URL, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    } catch {
      return { ok: false, code: 'UPSTREAM', message: 'Could not download the FYERS symbol master.' };
    }
    if (!response.ok) return { ok: false, code: 'UPSTREAM', message: 'Could not download the FYERS symbol master.' };
    master = { text: await response.text(), at: now() };
    return { ok: true, value: master.text };
  }

  // Lot size from the symbol master (column 3), for any contract of the underlying and expiry. Never hardcoded.
  async function lotSize(underlying: string, expiryIso: string): Promise<BrokerResult<number>> {
    const loaded = await loadMaster();
    if (!loaded.ok) return loaded;
    const { yy, mon } = expiryParts(expiryIso);
    const prefix = `NSE:${underlying}${String(yy).padStart(2, '0')}${mon}`;
    for (const line of loaded.value.split(/\r?\n/)) {
      const cols = line.split(',');
      const ticker = cols[9]?.trim();
      if (!ticker?.startsWith(prefix) || !/^(\d|FUT)/.test(ticker.slice(prefix.length))) continue;
      const lot = Number(cols[3]);
      if (Number.isInteger(lot) && lot > 0) return { ok: true, value: lot };
    }
    return { ok: false, code: 'NOT_FOUND', message: `No ${underlying} ${expiryIso} contract in the FYERS symbol master.` };
  }

  // OI per strike comes from the option chain, which FYERS serves for the nearest expiry only.
  async function optionOi(underlying: string, expiryIso: string, strike: number, kind: OptionKind): Promise<BrokerResult<number | null>> {
    const url = new URL(`${BASE}/data/options-chain-v3`);
    url.searchParams.set('symbol', fyersEquity(underlying));
    url.searchParams.set('strikecount', '10');
    const result = await call(url);
    if (!result.ok) return result;
    const data = result.value.data as { expiryData?: { date?: string }[]; optionsChain?: { option_type?: string; strike_price?: number | string; oi?: number | string }[] } | undefined;
    const date = data?.expiryData?.[0]?.date;
    const chainExpiry = date && /^\d{2}-\d{2}-\d{4}$/.test(date) ? `${date.slice(6)}-${date.slice(3, 5)}-${date.slice(0, 2)}` : null;
    if (chainExpiry !== expiryIso) return { ok: true, value: null };
    const leg = data?.optionsChain?.find((item) => item.option_type?.toUpperCase() === kind && finiteOrNull(item.strike_price) === strike);
    return { ok: true, value: leg ? finiteOrNull(leg.oi) : null };
  }

  // The whole chain around the money for one underlying (a FYERS symbol such as NSE:NIFTY50-INDEX or BSE:SENSEX-INDEX), nearest expiry. A transient
  // failure is retried with exponential backoff (500 ms, then 1 s, then 2 s); an expired login is returned at once. Failures are explicit.
  async function optionChain(underlying: string, strikecount = 20): Promise<BrokerResult<Payload>> {
    const url = new URL(`${BASE}/data/options-chain-v3`);
    url.searchParams.set('symbol', underlying);
    url.searchParams.set('strikecount', String(strikecount));
    let last: BrokerResult<Payload> = { ok: false, code: 'UPSTREAM', message: 'The option chain request did not run.' };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await call(url);
      if (result.ok || result.code !== 'UPSTREAM') return result;
      last = result;
      if (attempt < 3) await sleep(500 * 2 ** attempt);
    }
    return last;
  }

  return {
    name: 'fyers',
    equitySymbol: fyersEquity,
    indexSymbol: fyersIndex,
    optionSymbol(underlying, expiryIso, strike, kind) {
      const { yy, mon } = expiryParts(expiryIso);
      return fyersOption(underlying, yy, mon, strike, kind);
    },
    history,
    quote,
    lotSize,
    optionOi,
    optionChain,
  };
}

