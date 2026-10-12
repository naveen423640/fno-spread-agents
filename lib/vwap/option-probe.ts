// Does FYERS serve real option data for a contract that is alive today? Read-only checks of the option chain and of 5-minute and daily
// candles (with open interest) for one at-the-money call and put. Answers "what could a real option backtest or recorder be built on?".
import { fyersOption } from '../screener/symbols';

const FYERS_DATA_BASE = 'https://api-t1.fyers.in/data';
const AUTH_CODES = new Set([-8, -15, -16, -17]);

export type Creds = { clientId: string; accessToken: string };
export type ContractCheck = {
  symbol: string;
  intraday: { ok: boolean; error?: string; candles: number; firstDay: string | null; lastDay: string | null; sessions: number; hasOiColumn: boolean; candlesWithVolume: number; sample: number[] | null };
  daily: { ok: boolean; error?: string; candles: number; firstDay: string | null; lastDay: string | null; hasOiColumn: boolean };
};
export type OptionProbe = {
  underlying: string;
  chain: { ok: boolean; error?: string; legs: number; spot: number | null; expiries: string[]; legKeys: string[]; hasSymbolField: boolean; sampleLeg: Record<string, unknown> | null; rawSample: Record<string, unknown>[] };
  atmStrike: number | null;
  contracts: ContractCheck[];
  verdict: string[];
  loginRequired: boolean;
};

const istDay = (t: number) => new Date((t + 19_800) * 1000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function get(creds: Creds, url: URL, fetchImpl: typeof fetch): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetchImpl(url, { headers: { Authorization: `${creds.clientId}:${creds.accessToken}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}
const isAuth = (r: { status: number; body: Record<string, unknown> | null }) => r.status === 401 || (typeof r.body?.code === 'number' && AUTH_CODES.has(r.body.code));

async function candles(creds: Creds, symbol: string, resolution: string, from: string, to: string, fetchImpl: typeof fetch) {
  const url = new URL(`${FYERS_DATA_BASE}/history`);
  for (const [k, v] of Object.entries({ symbol, resolution, date_format: '1', range_from: from, range_to: to, cont_flag: '1', oi_flag: '1' })) url.searchParams.set(k, v);
  const r = await get(creds, url, fetchImpl);
  if (isAuth(r)) return { auth: true as const };
  const rows = Array.isArray(r.body?.candles) ? (r.body!.candles as number[][]) : [];
  return { auth: false as const, ok: r.body?.s === 'ok' && rows.length > 0, error: r.body?.s === 'ok' ? (rows.length ? undefined : 'no candles returned') : (typeof r.body?.message === 'string' ? r.body.message : `history failed (${r.status})`), rows };
}

export async function probeOptionData(deps: { credentials: Creds; underlying?: string; indexSymbol?: string; today: string; fetchImpl?: typeof fetch }): Promise<OptionProbe> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const underlying = deps.underlying ?? 'NIFTY';
  const indexSymbol = deps.indexSymbol ?? 'NSE:NIFTY50-INDEX';
  const out: OptionProbe = { underlying, chain: { ok: false, legs: 0, spot: null, expiries: [], legKeys: [], hasSymbolField: false, sampleLeg: null, rawSample: [] }, atmStrike: null, contracts: [], verdict: [], loginRequired: false };

  const url = new URL(`${FYERS_DATA_BASE}/options-chain-v3`);
  url.searchParams.set('symbol', indexSymbol);
  url.searchParams.set('strikecount', '5');
  const chainResponse = await get(deps.credentials, url, fetchImpl);
  if (isAuth(chainResponse)) { out.loginRequired = true; return out; }
  const data = chainResponse.body?.data as { optionsChain?: Record<string, unknown>[]; expiryData?: { date?: string }[] } | undefined;
  const legs = Array.isArray(data?.optionsChain) ? data!.optionsChain! : [];
  if (chainResponse.body?.s !== 'ok' || !legs.length) { out.chain.error = (typeof chainResponse.body?.message === 'string' ? chainResponse.body.message : `option chain failed (${chainResponse.status})`); out.verdict.push('The option chain call failed, so nothing further was checked.'); return out; }
  const optionLegs = legs.filter((l) => l.option_type === 'CE' || l.option_type === 'PE');
  const spotRow = legs.find((l) => !l.option_type);
  const spot = typeof spotRow?.ltp === 'number' ? spotRow.ltp : null;
  out.chain = { ok: true, legs: optionLegs.length, spot, expiries: (data?.expiryData ?? []).map((e) => String(e.date ?? '')), legKeys: Object.keys(optionLegs[0] ?? {}), hasSymbolField: typeof optionLegs[0]?.symbol === 'string', sampleLeg: optionLegs[0] ?? null, rawSample: legs.slice(0, 6) };

  const strikes = [...new Set(optionLegs.map((l) => Number(l.strike_price)).filter((s) => Number.isFinite(s) && s > 0))].sort((a, b) => a - b);
  const atm = spot === null ? strikes[Math.floor(strikes.length / 2)] : strikes.reduce((n, s) => (Math.abs(s - spot) < Math.abs(n - spot) ? s : n), strikes[0]);
  out.atmStrike = atm ?? null;
  if (atm === undefined) { out.verdict.push('The chain had no strikes.'); return out; }

  // Prefer the contract symbol FYERS gives in the chain; otherwise build the monthly one (e.g. NSE:NIFTY26OCT24500CE).
  const yy = Number(deps.today.slice(2, 4));
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const mon = months[Number(deps.today.slice(5, 7)) - 1];
  for (const type of ['CE', 'PE'] as const) {
    const leg = optionLegs.find((l) => l.option_type === type && Number(l.strike_price) === atm);
    // fyersOption builds an NSE symbol; a BSE index (SENSEX) trades on BSE, so the prefix follows the index symbol.
    const built = fyersOption(underlying, yy, mon, atm, type);
    const symbol = typeof leg?.symbol === 'string' ? leg.symbol : indexSymbol.startsWith('BSE:') ? built.replace(/^NSE:/, 'BSE:') : built;
    const intradayRows = await candles(deps.credentials, symbol, '5', addDays(deps.today, -10), deps.today, fetchImpl);
    if (intradayRows.auth) { out.loginRequired = true; return out; }
    const dailyRows = await candles(deps.credentials, symbol, 'D', addDays(deps.today, -60), deps.today, fetchImpl);
    if (dailyRows.auth) { out.loginRequired = true; return out; }
    const days = [...new Set(intradayRows.rows.map((r) => istDay(r[0])))].sort();
    const dDays = dailyRows.rows.map((r) => istDay(r[0])).sort();
    out.contracts.push({
      symbol,
      intraday: { ok: intradayRows.ok, error: intradayRows.error, candles: intradayRows.rows.length, firstDay: days[0] ?? null, lastDay: days[days.length - 1] ?? null, sessions: days.length, hasOiColumn: intradayRows.rows.some((r) => r.length >= 7), candlesWithVolume: intradayRows.rows.filter((r) => r[5] > 0).length, sample: intradayRows.rows[Math.floor(intradayRows.rows.length / 2)] ?? null },
      daily: { ok: dailyRows.ok, error: dailyRows.error, candles: dailyRows.rows.length, firstDay: dDays[0] ?? null, lastDay: dDays[dDays.length - 1] ?? null, hasOiColumn: dailyRows.rows.some((r) => r.length >= 7) },
    });
  }

  const ok = out.contracts.filter((c) => c.intraday.ok);
  out.verdict.push(out.chain.hasSymbolField ? 'The chain lists each contract\'s FYERS symbol.' : 'The chain legs carry no symbol field, so contract symbols were built from the monthly naming convention.');
  if (!ok.length) out.verdict.push('FYERS returned no 5-minute candles for the at-the-money contracts (the symbol may be wrong, e.g. a weekly contract, or option history is unavailable).');
  else {
    out.verdict.push(`5-minute option candles are available: ${ok.map((c) => `${c.symbol} ${c.intraday.sessions} sessions (${c.intraday.firstDay} to ${c.intraday.lastDay})`).join('; ')}.`);
    out.verdict.push(ok.some((c) => c.intraday.hasOiColumn) ? 'Candles include an open-interest column.' : 'Candles carry no open-interest column.');
    out.verdict.push('This covers contracts that are alive today only; expired contracts are not in the symbol master, so a long real-premium history would need recording going forward.');
  }
  return out;
}
