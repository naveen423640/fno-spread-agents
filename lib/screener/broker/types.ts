import type { BrokerResult, Candle, Quote } from '../types';

export type DateRange = { from: string; to: string };
export type OptionKind = 'CE' | 'PE';

// Read-only market-data access. There is deliberately no method that places, modifies or cancels anything.
export interface BrokerAdapter {
  readonly name: 'fyers' | 'kite' | 'mock';
  equitySymbol(ticker: string): string;
  indexSymbol(): string;
  optionSymbol(underlying: string, expiryIso: string, strike: number, kind: OptionKind): string;
  history(symbol: string, range: DateRange): Promise<BrokerResult<Candle[]>>;
  quote(symbol: string): Promise<BrokerResult<Quote>>;
  lotSize(underlying: string, expiryIso: string): Promise<BrokerResult<number>>;
  // Open interest at a strike. A successful null means the broker could not say (for example the chain is for another expiry).
  optionOi(underlying: string, expiryIso: string, strike: number, kind: OptionKind): Promise<BrokerResult<number | null>>;
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const LOGIN_MESSAGE = 'The broker login has expired. Sign in again.';

export function finiteOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Splits [from, to] into consecutive ranges of at most `maxDays` days, as the reference does for Fyers history.
export function chunkRange(range: DateRange, maxDays: number): DateRange[] {
  const chunks: DateRange[] = [];
  let cur = range.from;
  while (cur <= range.to) {
    const next = addDays(cur, maxDays) < range.to ? addDays(cur, maxDays) : range.to;
    chunks.push({ from: cur, to: next });
    cur = addDays(next, 1);
  }
  return chunks;
}
