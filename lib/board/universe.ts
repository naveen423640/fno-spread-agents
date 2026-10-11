import { marketSnapshot } from '@/lib/market-snapshot';
import { SECTOR_INDEX, sectorFor } from '@/lib/sectors';
import { expiryParts, monthlyExpiry } from '@/lib/screener/symbols';

export type BoardSymbol = { ticker: string; name: string; symbol: string; futures: string; sector: string; sectorIndex: string | null };

// Current-month stock futures, e.g. NSE:RELIANCE26OCTFUT. The expiry is the last Tuesday of the month, rolled to next month
// once it has passed; an exchange holiday can shift the real expiry, in which case the futures quote is skipped and OI scores zero.
export function futuresSymbol(ticker: string, todayIso: string): string {
  const { yy, mon } = expiryParts(monthlyExpiry(todayIso));
  return `NSE:${ticker}${String(yy).padStart(2, '0')}${mon}FUT`;
}

// The F&O universe is the app's 210-stock list. Refreshing it from the FYERS symbol master is not wired yet.
export function boardUniverse(todayIso: string): BoardSymbol[] {
  return marketSnapshot.map((stock) => {
    const sector = sectorFor(stock.ticker);
    return { ticker: stock.ticker, name: stock.name, symbol: stock.symbol, futures: futuresSymbol(stock.ticker, todayIso), sector, sectorIndex: SECTOR_INDEX[sector] ?? null };
  });
}

export const SECTOR_INDEX_SYMBOLS = [...new Set(Object.values(SECTOR_INDEX))];
