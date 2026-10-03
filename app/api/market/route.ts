import { fetchEngineUniverse } from '@/lib/engine-client';
import { marketSnapshot, snapshotAsOf, type MarketStock, type SectorIndex } from '@/lib/market-snapshot';
import { resolveUniverse } from '@/lib/universe';
import { describeLiveFeed } from '@/lib/market-session';

const FYERS_DATA_BASE = 'https://api-t1.fyers.in/data';
const NSE_ARCHIVE_BASE = 'https://nsearchives.nseindia.com/products/content';
const NSE_INDEX_ARCHIVE_BASE = 'https://nsearchives.nseindia.com/content/indices';

const sectorIndexDefinitions = [
  ['NSE:NIFTYBANK-INDEX', 'NIFTY BANK', 'Nifty Bank'],
  ['NSE:FINNIFTY-INDEX', 'NIFTY FINANCIAL SERVICES', 'Nifty Financial Services'],
  ['NSE:NIFTYIT-INDEX', 'NIFTY IT', 'Nifty IT'],
  ['NSE:NIFTYAUTO-INDEX', 'NIFTY AUTO', 'Nifty Auto'],
  ['NSE:NIFTYFMCG-INDEX', 'NIFTY FMCG', 'Nifty FMCG'],
  ['NSE:NIFTYPHARMA-INDEX', 'NIFTY PHARMA', 'Nifty Pharma'],
  ['NSE:NIFTYHEALTHCARE-INDEX', 'NIFTY HEALTHCARE INDEX', 'Nifty Healthcare'],
  ['NSE:NIFTYMETAL-INDEX', 'NIFTY METAL', 'Nifty Metal'],
  ['NSE:NIFTYENERGY-INDEX', 'NIFTY ENERGY', 'Nifty Energy'],
  ['NSE:NIFTYOILANDGAS-INDEX', 'NIFTY OIL & GAS', 'Nifty Oil & Gas'],
  ['NSE:NIFTYREALTY-INDEX', 'NIFTY REALTY', 'Nifty Realty'],
  ['NSE:NIFTYPSUBANK-INDEX', 'NIFTY PSU BANK', 'Nifty PSU Bank'],
  ['NSE:NIFTYPVTBANK-INDEX', 'NIFTY PRIVATE BANK', 'Nifty Private Bank'],
  ['NSE:NIFTYCONSRDURBL-INDEX', 'NIFTY CONSUMER DURABLES', 'Nifty Consumer Durables'],
  ['NSE:NIFTYMEDIA-INDEX', 'NIFTY MEDIA', 'Nifty Media'],
] as const;

type LiveMarketPayload = { stocks: typeof marketSnapshot; sectorIndices: SectorIndex[] };
let fyersLiveCache: { key: string; expiresAt: number; promise: Promise<LiveMarketPayload> } | null = null;

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return Response.json(body, {
    ...init,
    headers,
  });
}

function dateStamp(date: string) {
  const [year, month, day] = date.split('-');
  return `${day}${month}${year}`;
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }

  cells.push(current.trim());
  return cells;
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get('cookie') ?? '';
  const prefix = `${name}=`;
  const match = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}

async function loadFyersLive(clientId: string, accessToken: string, universe: MarketStock[]): Promise<LiveMarketPayload> {
  const batches: string[][] = [];
  for (let index = 0; index < universe.length; index += 50) {
    batches.push(universe.slice(index, index + 50).map((stock) => stock.symbol));
  }

  async function quotes(symbols: string[]) {
      const url = new URL(`${FYERS_DATA_BASE}/quotes`);
      url.searchParams.set('symbols', symbols.join(','));
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await fetch(url, { headers: { Authorization: `${clientId}:${accessToken}`, Accept: 'application/json' } });
        if (response.status !== 429) break;
        const retryAfter = Number(response.headers.get('Retry-After') ?? 0);
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1_000, 750 * (attempt + 1))));
      }
      if (!response) throw new Error('FYERS live request did not start.');
      const payload = await response.json().catch(() => null) as { s?: string; code?: number; message?: string; d?: Array<{ n: string; s: string; v?: Record<string, number> }> } | null;
      if (!response.ok || payload?.s === 'error') throw new Error(`FYERS live request failed (${response.status}${payload?.code ? ` / ${payload.code}` : ''})${payload?.message ? `: ${payload.message}` : ''}`);
      return payload ?? { s: 'error', d: [] };
  }

  const responses = [];
  for (let index = 0; index < batches.length; index += 1) {
    responses.push(await quotes(batches[index]));
    if (index < batches.length - 1) await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const names = new Map(universe.map((stock) => [stock.symbol, stock]));
  const stocks = responses.flatMap((payload) => payload.d ?? []).flatMap((quote) => {
    const reference = names.get(quote.n);
    const values = quote.v;
    if (!reference || quote.s !== 'ok' || !values) return [];
    const price = Number(values.lp ?? 0);
    const change = Number(values.ch ?? 0);
    return [{
      ...reference,
      price,
      change,
      changePct: Number(values.chp ?? 0),
      previousClose: price - change,
      open: Number(values.open_price ?? values.open ?? 0) || undefined,
      high: Number(values.high_price ?? values.high ?? 0) || undefined,
      low: Number(values.low_price ?? values.low ?? 0) || undefined,
      volume: Number(values.volume ?? 0) || undefined,
    }];
  });

  if (!stocks.length) throw new Error('FYERS returned no live quotes');
  const indexNames = new Map<string, string>(sectorIndexDefinitions.map(([symbol, , name]) => [symbol, name]));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const indexPayload = await quotes(sectorIndexDefinitions.map(([symbol]) => symbol)).catch(() => null);
  const sectorIndices: SectorIndex[] = (indexPayload?.d ?? []).flatMap((quote) => {
    const name = indexNames.get(quote.n);
    const values = quote.v;
    if (!name || quote.s !== 'ok' || !values) return [];
    const price = Number(values.lp ?? 0);
    const change = Number(values.ch ?? 0);
    if (!Number.isFinite(price) || price <= 0) return [];
    return [{ symbol: quote.n, name, price, change, changePct: Number(values.chp ?? 0), previousClose: price - change }];
  });
  return { stocks, sectorIndices };
}

async function fetchFyersLive(request: Request, universe: MarketStock[]) {
  const clientId = process.env.FYERS_CLIENT_ID;
  const accessToken = cookieValue(request, 'fyers_access_token') ?? process.env.FYERS_ACCESS_TOKEN;
  if (!clientId || !accessToken) return null;

  const key = `${clientId}:${accessToken}:${universe.map((stock) => stock.ticker).join(',')}`;
  if (fyersLiveCache?.key === key && fyersLiveCache.expiresAt > Date.now()) return fyersLiveCache.promise;
  const promise = loadFyersLive(clientId, accessToken, universe);
  fyersLiveCache = { key, expiresAt: Date.now() + 180_000, promise };
  try {
    return await promise;
  } catch (error) {
    if (fyersLiveCache?.promise === promise) fyersLiveCache.expiresAt = Date.now() + 30_000;
    throw error;
  }
}

async function fetchHistoricalSectorIndices(date: string) {
  const response = await fetch(`${NSE_INDEX_ARCHIVE_BASE}/ind_close_all_${dateStamp(date)}.csv`, {
    headers: { Accept: 'text/csv,*/*', 'User-Agent': 'Mozilla/5.0 NSE-FNO-Heatmap/1.0', Referer: 'https://www.nseindia.com/' },
  });
  if (!response.ok) return [];
  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const column = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const indexes = { name: column('INDEXNAME'), close: column('CLOSINGINDEXVALUE', 'CLOSEINDEXVALUE'), points: column('POINTSCHANGE'), percent: column('CHANGE') };
  if (indexes.name < 0 || indexes.close < 0 || indexes.percent < 0) return [];
  const definitions = new Map<string, { symbol: string; name: string }>(sectorIndexDefinitions.map(([symbol, nseName, name]) => [nseName, { symbol, name }]));
  return lines.slice(1).flatMap((line): SectorIndex[] => {
    const cells = parseCsvLine(line);
    const definition = definitions.get(cells[indexes.name]?.trim().toUpperCase());
    if (!definition) return [];
    const price = Number(cells[indexes.close]);
    const change = indexes.points >= 0 ? Number(cells[indexes.points]) : 0;
    const changePct = Number(cells[indexes.percent]);
    if (!Number.isFinite(price) || !Number.isFinite(changePct)) return [];
    return [{ ...definition, price, change: Number.isFinite(change) ? change : 0, changePct, previousClose: price - (Number.isFinite(change) ? change : 0) }];
  });
}

async function fetchHistorical(date: string, stocksUniverse: MarketStock[]) {
  const archiveUrl = `${NSE_ARCHIVE_BASE}/sec_bhavdata_full_${dateStamp(date)}.csv`;
  const response = await fetch(archiveUrl, {
    headers: {
      Accept: 'text/csv,*/*',
      'User-Agent': 'Mozilla/5.0 NSE-FNO-Heatmap/1.0',
      Referer: 'https://www.nseindia.com/',
    },
  });

  if (!response.ok) {
    throw new Error(response.status === 404 ? 'No NSE trading report exists for this date.' : `NSE archive request failed (${response.status})`);
  }

  const csv = await response.text();
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('The NSE report was empty.');

  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toUpperCase());
  const column = (name: string) => headers.indexOf(name);
  const indexes = {
    symbol: column('SYMBOL'),
    series: column('SERIES'),
    previousClose: column('PREV_CLOSE'),
    open: column('OPEN_PRICE'),
    high: column('HIGH_PRICE'),
    low: column('LOW_PRICE'),
    close: column('CLOSE_PRICE'),
    volume: column('TTL_TRD_QNTY'),
  };

  if (indexes.symbol < 0 || indexes.close < 0 || indexes.previousClose < 0) {
    throw new Error('NSE changed the historical report format.');
  }

  const universe = new Map(stocksUniverse.map((stock) => [stock.ticker, stock]));
  const stocks = lines.slice(1).flatMap((line) => {
    const cells = parseCsvLine(line);
    const ticker = cells[indexes.symbol]?.trim();
    const reference = universe.get(ticker);
    if (!reference || (indexes.series >= 0 && cells[indexes.series]?.trim() !== 'EQ')) return [];

    const price = Number(cells[indexes.close]);
    const previousClose = Number(cells[indexes.previousClose]);
    if (!Number.isFinite(price) || !Number.isFinite(previousClose) || previousClose === 0) return [];

    return [{
      ...reference,
      price,
      previousClose,
      change: price - previousClose,
      changePct: ((price / previousClose) - 1) * 100,
      open: Number(cells[indexes.open]) || undefined,
      high: Number(cells[indexes.high]) || undefined,
      low: Number(cells[indexes.low]) || undefined,
      volume: Number(cells[indexes.volume]) || undefined,
    }];
  });

  if (!stocks.length) throw new Error('No current F&O-universe stocks were found in that NSE report.');
  return stocks;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? 'live';

  try {
    if (date === 'live') {
      const resolved = resolveUniverse(marketSnapshot, await fetchEngineUniverse('latest'));
      const universeInfo = { source: resolved.source, date: resolved.date, count: resolved.stocks.length, note: resolved.note };
      const live = await fetchFyersLive(request, resolved.stocks);
      if (live) {
        const feed = describeLiveFeed(new Date());
        return json({ ...live, ...feed, universe: universeInfo, sectorSource: 'FYERS Nifty sector indices', ...(feed.live ? {} : { notice: 'Market closed. Showing the last close.' }) });
      }

      return json({
        stocks: resolved.stocks,
        universe: universeInfo,
        asOf: snapshotAsOf,
        source: 'FYERS embedded snapshot',
        sectorIndices: [],
        sectorSource: 'Connect FYERS for live Nifty sector indices',
        live: false,
        notice: 'Connect FYERS to enable automatic live refresh.',
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: 'Choose a valid trading date.' }, { status: 400 });
    }

    const resolved = resolveUniverse(marketSnapshot, await fetchEngineUniverse(date));
    const universeInfo = { source: resolved.source, date: resolved.date, count: resolved.stocks.length, note: resolved.note };
    const [stocks, sectorIndices] = await Promise.all([fetchHistorical(date, resolved.stocks), fetchHistoricalSectorIndices(date)]);
    return json({ stocks, universe: universeInfo, sectorIndices, asOf: `${date}T15:30:00+05:30`, source: 'NSE official bhavcopy', sectorSource: 'NSE official index close', live: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load market data.';
    console.error(`[market] ${message}`);
    return json({ error: message }, { status: 502 });
  }
}
