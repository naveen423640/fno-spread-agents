import type { StockHistory, IndexHistory } from './backtest';
import type { LoadedHistory } from './hist-store';
import { boardUniverse, SECTOR_INDEX_SYMBOLS } from './universe';

// Turns the cached history into the shapes the replay takes. A stock needs candles and daily history; missing OI is allowed.
export function assembleHistory(history: LoadedHistory, todayIso: string): { stocks: StockHistory[]; indices: IndexHistory } {
  const stocks: StockHistory[] = [];
  for (const u of boardUniverse(todayIso)) {
    const m5 = history.m5.get(u.symbol);
    const daily = history.daily.get(u.symbol);
    if (!m5?.size || !daily?.length) continue;
    stocks.push({ symbol: u.symbol, ticker: u.ticker, sector: u.sector, sectorIndex: u.sectorIndex, m5, daily, oi: history.oi.get(u.symbol) ?? new Map() });
  }
  const indices: IndexHistory = new Map();
  for (const symbol of SECTOR_INDEX_SYMBOLS) {
    const m5 = history.m5.get(symbol);
    if (m5?.size) indices.set(symbol, m5);
  }
  return { stocks, indices };
}
