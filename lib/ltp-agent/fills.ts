// Fill prices. A buy pays the ask and a sell receives the bid, each moved against us by the slippage ticks. With no quote on the side we need,
// the LTP moved by the fallback percent is used and the fill says so. With neither there is no price: null, never an invented one.
import type { ChainRow } from '@/lib/ltp/types';
import type { Strategy } from './strategy';

export type FillQuality = 'quote' | 'ltp_fallback';
export type Fill = { price: number; quality: FillQuality };

const cents = (x: number) => Math.round(x * 100) / 100;

export function fillPrice(row: ChainRow, action: 'buy' | 'sell', fills: Strategy['fills']): Fill | null {
  const quote = action === 'buy' ? row.ask : row.bid;
  const slip = fills.slippage_ticks * fills.tick;
  if (quote !== undefined && quote > 0) {
    return { price: cents(action === 'buy' ? quote + slip : Math.max(fills.tick, quote - slip)), quality: 'quote' };
  }
  if (row.ltp === null || !(row.ltp > 0)) return null;
  const moved = action === 'buy' ? row.ltp * (1 + fills.fallback_slippage_pct / 100) : row.ltp * (1 - fills.fallback_slippage_pct / 100);
  return { price: cents(action === 'sell' ? Math.max(fills.tick, moved) : moved), quality: 'ltp_fallback' };
}
