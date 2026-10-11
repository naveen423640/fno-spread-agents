// Lot sizes and option strikes from the public FYERS NSE_FO symbol master (no login needed). Layout checked on 12 Oct 2026:
//   col 1 description ("TCS 27 Oct 26 1520 CE"), col 3 lot size, col 9 contract symbol, col 13 underlying, col 15 strike, col 16 CE/PE/XX.
// Only today's contracts are listed, so the lot size is today's and is applied to past dates (lot sizes change over time).
export const SYMBOL_MASTER_URL = 'https://public.fyers.in/sym_details/NSE_FO.csv';

export type SymbolMaster = { lots: Map<string, number>; strikes: Map<string, number[]>; expiry: Map<string, string> };

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

export function parseSymbolMaster(csv: string): SymbolMaster {
  const lots = new Map<string, number>();
  const expiryStrikes = new Map<string, Map<string, Set<number>>>(); // underlying -> expiry ISO -> strikes
  for (const line of csv.split(/\r?\n/)) {
    const c = line.split(',');
    if (c.length < 17) continue;
    const underlying = c[13].trim();
    const lot = Number(c[3]);
    if (!underlying || !Number.isInteger(lot) || lot <= 0) continue;
    const kind = c[16].trim();
    if (kind === 'XX') { if (!lots.has(underlying)) lots.set(underlying, lot); continue; }
    if (kind !== 'CE' && kind !== 'PE') continue;
    const strike = Number(c[15]);
    const match = /(\d{1,2}) ([A-Z][a-z]{2}) (\d{2})/.exec(c[1]);
    if (!Number.isFinite(strike) || !match) continue;
    const expiry = `20${match[3]}-${MONTHS[match[2]] ?? '00'}-${match[1].padStart(2, '0')}`;
    const byExpiry = expiryStrikes.get(underlying) ?? new Map<string, Set<number>>();
    byExpiry.set(expiry, (byExpiry.get(expiry) ?? new Set<number>()).add(strike));
    expiryStrikes.set(underlying, byExpiry);
  }
  const strikes = new Map<string, number[]>();
  const expiry = new Map<string, string>();
  for (const [underlying, byExpiry] of expiryStrikes) {
    const nearest = [...byExpiry.keys()].sort()[0]; // the nearest expiry has the finest strike grid
    expiry.set(underlying, nearest);
    strikes.set(underlying, [...byExpiry.get(nearest)!].sort((a, b) => a - b));
  }
  return { lots, strikes, expiry };
}

// The strike spacing right around the spot: the smallest gap among the listed strikes nearest to it.
export function strikeStepNear(strikes: number[], spot: number): number | null {
  if (strikes.length < 3) return null;
  const nearest = [...strikes].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 6).sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < nearest.length; i += 1) step = Math.min(step, nearest[i] - nearest[i - 1]);
  return Number.isFinite(step) && step > 0 ? step : null;
}

export async function loadSymbolMaster(deps: { fetchImpl?: typeof fetch; readCache?: () => string | null; writeCache?: (csv: string) => void } = {}): Promise<SymbolMaster> {
  const cached = deps.readCache?.();
  if (cached) return parseSymbolMaster(cached);
  const response = await (deps.fetchImpl ?? fetch)(SYMBOL_MASTER_URL, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`The FYERS symbol master could not be loaded (${response.status}).`);
  const csv = await response.text();
  deps.writeCache?.(csv);
  return parseSymbolMaster(csv);
}
