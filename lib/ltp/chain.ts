// A: turns one FYERS options-chain-v3 response into a Snapshot. Written against real responses (see tests/fixtures/ltp): each leg has
// ltp, oi, oich (OI change on the day), volume (cumulative), strike_price, option_type and its own symbol; the spot is the leg with an empty
// option_type and strike_price -1; expiryData holds DD-MM-YYYY dates, nearest first. A missing field is stored as null and flagged, never invented.
import { LTP_CONFIG } from './config';
import { istDate, istTs } from './time';
import type { ChainRow, Side, Snapshot } from './types';

export type ParseOk = { ok: true; snapshot: Snapshot; warnings: string[]; missing: string[] };
export type ParseFail = { ok: false; reason: 'login_required' | 'upstream' | 'empty' | 'malformed'; message: string };
export type ParseContext = { underlying: string; snapshotTs: number; latencyMs: number | null };

const AUTH_CODES = new Set([-8, -15, -16, -17]);
const FIELDS: [keyof Pick<ChainRow, 'ltp' | 'oi' | 'oiChange' | 'volume'>, string][] = [['ltp', 'ltp'], ['oi', 'oi'], ['oiChange', 'oich'], ['volume', 'volume']];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const toIso = (ddmmyyyy: string) => (/^\d{2}-\d{2}-\d{4}$/.test(ddmmyyyy) ? `${ddmmyyyy.slice(6)}-${ddmmyyyy.slice(3, 5)}-${ddmmyyyy.slice(0, 2)}` : null);

// The most common difference between neighbouring strikes (the smaller one on a tie). Null with fewer than two distinct strikes.
export function deriveStep(strikes: number[]): number | null {
  const sorted = [...new Set(strikes)].sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const counts = new Map<number, number>();
  for (let i = 1; i < sorted.length; i += 1) { const d = sorted[i] - sorted[i - 1]; counts.set(d, (counts.get(d) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

// The first expiry (an ISO date) that is today or later. On expiry day today's expiry is used up to and including 15:30 IST, then the next.
export function nearestExpiry(expiries: string[], nowTs: number): string | null {
  const today = istDate(nowTs);
  const afterClose = nowTs > istTs(today, '15:30');
  const dates = expiries.map(toIso).filter((d): d is string => d !== null).sort();
  return dates.find((d) => (d === today ? !afterClose : d > today)) ?? null;
}

export function parseChain(raw: unknown, ctx: ParseContext): ParseOk | ParseFail {
  if (!isRecord(raw)) return { ok: false, reason: 'malformed', message: 'The option chain response was not an object.' };
  if (raw.s === 'error' || raw.s === 'no_data') {
    const login = typeof raw.code === 'number' && AUTH_CODES.has(raw.code);
    return { ok: false, reason: login ? 'login_required' : 'upstream', message: typeof raw.message === 'string' && raw.message ? raw.message : 'FYERS returned an error for the option chain.' };
  }
  const data = isRecord(raw.data) ? raw.data : null;
  const legs = Array.isArray(data?.optionsChain) ? (data!.optionsChain as unknown[]).filter(isRecord) : null;
  if (!legs) return { ok: false, reason: 'malformed', message: 'The option chain response had no optionsChain list.' };

  const spotLeg = legs.find((l) => (l.option_type === '' || l.option_type === undefined || (num(l.strike_price) ?? 0) < 0) && num(l.ltp) !== null);
  const optionLegs = legs.filter((l) => (l.option_type === 'CE' || l.option_type === 'PE') && (num(l.strike_price) ?? 0) > 0);
  if (!optionLegs.length) return { ok: false, reason: 'empty', message: 'The option chain had no option legs.' };
  if (!spotLeg) return { ok: false, reason: 'malformed', message: 'The option chain had no spot (underlying) row.' };

  const expiryList = Array.isArray(data?.expiryData) ? (data!.expiryData as unknown[]).filter(isRecord).map((e) => (typeof e.date === 'string' ? e.date : '')) : [];
  const expiry = nearestExpiry(expiryList, ctx.snapshotTs);
  if (!expiry) return { ok: false, reason: 'malformed', message: 'The option chain had no usable expiry date.' };

  const warnings: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  const rows: ChainRow[] = [];
  for (const leg of optionLegs) {
    const strike = num(leg.strike_price)!;
    const side = leg.option_type as Side;
    const key = `${side}:${strike}`;
    if (seen.has(key)) { warnings.push(`duplicate ${side} ${strike} ignored (kept the first)`); continue; }
    seen.add(key);
    const row: ChainRow = { strike, side, ltp: null, oi: null, oiChange: null, volume: null, flags: [] };
    for (const [field, source] of FIELDS) {
      const v = num(leg[source]);
      row[field] = v;
      if (v === null) { row.flags.push(field); missing.push(`${side} ${strike} ${field}`); }
    }
    // A zero bid or ask is FYERS saying there is no market on that side, so it is left out and flagged rather than stored as a price of 0.
    const bid = num(leg.bid);
    const ask = num(leg.ask);
    if (bid !== null && bid > 0) row.bid = bid;
    if (ask !== null && ask > 0) row.ask = ask;
    if (row.bid === undefined || row.ask === undefined) row.flags.push('no_quote');
    rows.push(row);
  }

  const strikes = rows.map((r) => r.strike);
  const step = deriveStep(strikes);
  if (step === null) return { ok: false, reason: 'empty', message: 'The option chain had fewer than two strikes, so no strike step could be derived.' };
  const expected = LTP_CONFIG.expectedStep[ctx.underlying];
  if (expected !== undefined && step !== expected) warnings.push(`derived strike step ${step} differs from the expected ${expected} for ${ctx.underlying}`);
  const first = expiryList[0] ? toIso(expiryList[0]) : null;
  if (first && first !== expiry) warnings.push(`the chain's own expiry list starts at ${first} but ${expiry} is the nearest from today`);

  const fp = num(spotLeg.fp);
  const snapshot: Snapshot = { ts: ctx.snapshotTs, underlying: ctx.underlying, expiry, spot: num(spotLeg.ltp)!, step, fetchLatencyMs: ctx.latencyMs, rows };
  if (fp !== null && fp > 0) snapshot.futures = fp; // the index row's `fp` is the futures price
  return { ok: true, snapshot, warnings, missing };
}
