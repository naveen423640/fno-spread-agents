import { expiryParts, kiteEquity, kiteIndex, kiteOption } from '../symbols';
import type { BrokerResult, Candle, Quote } from '../types';
import { chunkRange, defaultSleep, finiteOrNull, LOGIN_MESSAGE, type BrokerAdapter, type DateRange, type OptionKind } from './types';

// Kite Connect read-only market data, written from the public API documentation. There is no Kite account in this project,
// so this adapter is tested with mocked responses only and has never talked to Kite. Historical data may need Kite's paid add-on.
const BASE = 'https://api.kite.trade';
const HISTORY_CHUNK_DAYS = 2000;
const HISTORY_THROTTLE_MS = 350;

export type KiteDeps = {
  credentials: { apiKey: string; accessToken: string };
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

// Minimal CSV line splitter that understands double-quoted fields.
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { fields.push(cur); cur = ''; } else cur += ch;
  }
  fields.push(cur);
  return fields;
}

function parseInstruments(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(splitCsvLine(line).map((value, i) => [header[i], value])));
}

export function createKiteAdapter(deps: KiteDeps): BrokerAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const headers = { Authorization: `token ${deps.credentials.apiKey}:${deps.credentials.accessToken}`, 'X-Kite-Version': '3' };
  let nseTokens: Map<string, string> | null = null;
  let nfoRows: Record<string, string>[] | null = null;

  async function call(url: string): Promise<BrokerResult<Response>> {
    let response: Response;
    try {
      response = await fetchImpl(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    } catch {
      return { ok: false, code: 'UPSTREAM', message: 'Could not reach Kite. Try again shortly.' };
    }
    return { ok: true, value: response };
  }

  async function json(url: string): Promise<BrokerResult<{ data?: unknown }>> {
    const result = await call(url);
    if (!result.ok) return result;
    const body = (await result.value.json().catch(() => null)) as { status?: string; error_type?: string; message?: string; data?: unknown } | null;
    if (result.value.status === 403 || body?.error_type === 'TokenException') return { ok: false, code: 'LOGIN_REQUIRED', message: LOGIN_MESSAGE };
    if (!result.value.ok || !body || body.status === 'error') return { ok: false, code: 'UPSTREAM', message: body?.message ?? `Kite request failed (${result.value.status}).` };
    return { ok: true, value: body };
  }

  async function dump(exchange: 'NSE' | 'NFO'): Promise<BrokerResult<Record<string, string>[]>> {
    const result = await call(`${BASE}/instruments/${exchange}`);
    if (!result.ok) return result;
    if (result.value.status === 403) return { ok: false, code: 'LOGIN_REQUIRED', message: LOGIN_MESSAGE };
    if (!result.value.ok) return { ok: false, code: 'UPSTREAM', message: `Could not download the Kite ${exchange} instruments.` };
    return { ok: true, value: parseInstruments(await result.value.text()) };
  }

  async function tokenFor(symbol: string): Promise<BrokerResult<string>> {
    if (!nseTokens) {
      const rows = await dump('NSE');
      if (!rows.ok) return rows;
      nseTokens = new Map(rows.value.map((row) => [`NSE:${row.tradingsymbol}`, row.instrument_token]));
    }
    const token = nseTokens.get(symbol);
    return token ? { ok: true, value: token } : { ok: false, code: 'NOT_FOUND', message: `${symbol} is not in the Kite instruments.` };
  }

  async function history(symbol: string, range: DateRange): Promise<BrokerResult<Candle[]>> {
    const token = await tokenFor(symbol);
    if (!token.ok) return token;
    const byDate = new Map<string, Candle>();
    const chunks = chunkRange(range, HISTORY_CHUNK_DAYS);
    for (let k = 0; k < chunks.length; k += 1) {
      const result = await json(`${BASE}/instruments/historical/${token.value}/day?from=${chunks[k].from}&to=${chunks[k].to}`);
      if (!result.ok) return result;
      const candles = (result.value.data as { candles?: [string, number, number, number, number, number][] } | undefined)?.candles;
      if (!Array.isArray(candles)) return { ok: false, code: 'UPSTREAM', message: `Kite returned no candle list for ${symbol}.` };
      for (const row of candles) byDate.set(row[0].slice(0, 10), { date: row[0].slice(0, 10), open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] });
      // Pause after every call, including the last, so consecutive symbols also stay under Kite's request limit.
      await sleep(HISTORY_THROTTLE_MS);
    }
    if (!byDate.size) return { ok: false, code: 'UPSTREAM', message: `Kite returned no candles for ${symbol}.` };
    return { ok: true, value: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  }

  async function quote(symbol: string): Promise<BrokerResult<Quote>> {
    const result = await json(`${BASE}/quote?i=${encodeURIComponent(symbol)}`);
    if (!result.ok) return result;
    const entry = (result.value.data as Record<string, { last_price?: unknown; oi?: unknown; depth?: { buy?: { price?: unknown }[]; sell?: { price?: unknown }[] } }> | undefined)?.[symbol];
    if (!entry) return { ok: false, code: 'NOT_FOUND', message: `No quote for ${symbol}.` };
    return { ok: true, value: { bid: finiteOrNull(entry.depth?.buy?.[0]?.price), ask: finiteOrNull(entry.depth?.sell?.[0]?.price), ltp: finiteOrNull(entry.last_price), oi: finiteOrNull(entry.oi) } };
  }

  async function lotSize(underlying: string, expiryIso: string): Promise<BrokerResult<number>> {
    if (!nfoRows) {
      const rows = await dump('NFO');
      if (!rows.ok) return rows;
      nfoRows = rows.value;
    }
    const row = nfoRows.find((item) => item.name === underlying && item.expiry === expiryIso);
    const lot = Number(row?.lot_size);
    return Number.isInteger(lot) && lot > 0 ? { ok: true, value: lot } : { ok: false, code: 'NOT_FOUND', message: `No ${underlying} ${expiryIso} contract in the Kite instruments.` };
  }

  const optionSymbol = (underlying: string, expiryIso: string, strike: number, kind: OptionKind) => {
    const { yy, mon } = expiryParts(expiryIso);
    return kiteOption(underlying, yy, mon, strike, kind);
  };

  return {
    name: 'kite',
    equitySymbol: kiteEquity,
    indexSymbol: kiteIndex,
    optionSymbol,
    history,
    quote,
    lotSize,
    async optionOi(underlying, expiryIso, strike, kind) {
      const result = await quote(optionSymbol(underlying, expiryIso, strike, kind));
      return result.ok ? { ok: true, value: result.value.oi } : result;
    },
  };
}
