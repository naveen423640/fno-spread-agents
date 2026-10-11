import { marketSnapshot } from '../market-snapshot';
import { sectorFor, sectorSets } from '../sectors';
import type { VwapStore } from './store';

export type UniverseEntry = { ticker: string; symbol: string; name: string; sector: string };

const NIFTY500_URL = 'https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv';

// Tickers NSE or FYERS renamed. The key is the old ticker, the value the one FYERS trades today.
export const TICKER_ALIASES: Record<string, string> = { LTIM: 'LTM' };

export const NIFTY_IT = ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'LTM', 'PERSISTENT', 'COFORGE', 'MPHASIS', 'OFSS'];

export const toFyersSymbol = (ticker: string) => `NSE:${TICKER_ALIASES[ticker] ?? ticker}-EQ`;
const entry = (ticker: string, name = ticker, sector = 'Other'): UniverseEntry => {
  const t = TICKER_ALIASES[ticker] ?? ticker;
  return { ticker: t, symbol: toFyersSymbol(t), name, sector };
};

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let current = '', quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i += 1; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { cells.push(current.trim()); current = ''; }
    else current += ch;
  }
  cells.push(current.trim());
  return cells;
}

// NSE's index list: Company Name, Industry, Symbol, Series, ISIN Code. Only EQ-series rows are kept.
export function parseNifty500Csv(csv: string): UniverseEntry[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = csvCells(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [name, industry, symbol, series] = [col('company name'), col('industry'), col('symbol'), col('series')];
  if (symbol < 0) return [];
  return lines.slice(1).flatMap((line) => {
    const c = csvCells(line);
    if (!c[symbol] || (series >= 0 && c[series] && c[series] !== 'EQ')) return [];
    return [entry(c[symbol], name >= 0 ? c[name] : c[symbol], industry >= 0 ? c[industry] : 'Other')];
  });
}

export type UniverseDeps = { store?: VwapStore; fetchImpl?: typeof fetch; today: string };

// The Nifty 500 list is cached and refreshed once a calendar month; an older cache is used if NSE cannot be reached.
export async function loadNifty500(deps: UniverseDeps): Promise<UniverseEntry[]> {
  const cached = deps.store ? await deps.store.getUniverse('nifty500') : null;
  const fresh = cached && cached.fetchedDay.slice(0, 7) === deps.today.slice(0, 7);
  if (cached && fresh) return cached.symbols as UniverseEntry[];
  try {
    const response = await (deps.fetchImpl ?? fetch)(NIFTY500_URL, { headers: { Accept: 'text/csv,*/*', 'User-Agent': 'Mozilla/5.0 NSE-FNO-Heatmap/1.0', Referer: 'https://www.nseindia.com/' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`NSE returned ${response.status}`);
    const entries = parseNifty500Csv(await response.text());
    if (entries.length < 400) throw new Error('the NSE list looked incomplete');
    if (deps.store) await deps.store.saveUniverse('nifty500', entries, deps.today);
    return entries;
  } catch (error) {
    if (cached) return cached.symbols as UniverseEntry[];
    throw new Error(`Could not load the Nifty 500 list: ${error instanceof Error ? error.message : 'unreachable'}`);
  }
}

// Universe names: nifty_it, fo, nifty500, sector:<F&O sector>, industry:<Nifty 500 industry>, custom:TCS,INFY.
export async function loadUniverse(spec: string, deps: UniverseDeps): Promise<UniverseEntry[]> {
  const kind = spec.split(':')[0];
  const rest = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : '';
  const fo = () => marketSnapshot.map((s) => entry(s.ticker, s.name, sectorFor(s.ticker)));
  switch (kind.toLowerCase()) {
    case 'nifty_it': return NIFTY_IT.map((t) => entry(t, t, 'Information Technology'));
    case 'fo': return fo();
    case 'nifty500': return loadNifty500(deps);
    case 'sector': {
      const wanted = Object.keys(sectorSets).find((k) => k.toLowerCase() === rest.toLowerCase());
      if (!wanted) throw new Error(`Unknown sector "${rest}". Choose one of: ${Object.keys(sectorSets).join(', ')}.`);
      return fo().filter((e) => e.sector === wanted);
    }
    case 'industry': return (await loadNifty500(deps)).filter((e) => e.sector.toLowerCase() === rest.toLowerCase());
    case 'custom': {
      const tickers = [...new Set(rest.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
      if (!tickers.length) throw new Error('Give at least one ticker, e.g. custom:TCS,INFY.');
      const known = new Map(fo().map((e) => [e.ticker, e]));
      return tickers.map((t) => known.get(TICKER_ALIASES[t] ?? t) ?? entry(t));
    }
    default: throw new Error(`Unknown universe "${spec}". Use nifty_it, fo, nifty500, sector:<name>, industry:<name> or custom:<tickers>.`);
  }
}
