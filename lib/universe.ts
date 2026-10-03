import type { EngineUniverse } from '@/lib/engine-client';
import type { MarketStock } from '@/lib/market-snapshot';

export type ResolvedUniverse = { stocks: MarketStock[]; source: 'engine' | 'static'; date: string | null; note: string };

export function resolveUniverse(snapshot: MarketStock[], engine: EngineUniverse | null): ResolvedUniverse {
  if (!engine || engine.entries.length === 0) {
    return { stocks: snapshot, source: 'static', date: null, note: 'Engine unavailable: showing the static universe list (dated 2026-08-31).' };
  }
  const known = new Map(snapshot.map((stock) => [stock.ticker, stock]));
  const stocks = engine.entries.map(({ ticker }): MarketStock => known.get(ticker) ?? { symbol: `NSE:${ticker}-EQ`, ticker, name: ticker, price: 0, change: 0, changePct: 0, previousClose: 0 });
  return { stocks, source: 'engine', date: engine.date, note: `F&O universe from the engine, as of ${engine.date}.` };
}

// Newly listed tickers carry a zero placeholder quote that only a FYERS quote overwrites.
// Without FYERS they would distort statistics, so the embedded-snapshot path hides them.
export function withoutPlaceholders(stocks: MarketStock[]): { stocks: MarketStock[]; hidden: number } {
  const real = stocks.filter((stock) => !(stock.price === 0 && stock.previousClose === 0));
  return { stocks: real, hidden: stocks.length - real.length };
}
