import { describe, expect, it } from 'vitest';

import { fillPrice } from '@/lib/ltp-agent/fills';
import type { ChainRow } from '@/lib/ltp/types';

const fills = { slippage_ticks: 1, tick: 0.05, fallback_slippage_pct: 2 };
const row = (over: Partial<ChainRow> = {}): ChainRow => ({ strike: 24000, side: 'CE', ltp: 100, oi: 1, oiChange: 0, volume: 1, flags: [], ...over });

describe('fillPrice', () => {
  it('a buy fills at the ask plus the slippage ticks, a sell at the bid minus them', () => {
    expect(fillPrice(row({ bid: 21.2, ask: 21.25 }), 'buy', fills)).toEqual({ price: 21.3, quality: 'quote' });
    expect(fillPrice(row({ bid: 21.2, ask: 21.25 }), 'sell', fills)).toEqual({ price: 21.15, quality: 'quote' });
  });
  it('slippage ticks scale the move: 3 ticks on a 21.25 ask is 21.40', () => {
    expect(fillPrice(row({ bid: 21.2, ask: 21.25 }), 'buy', { ...fills, slippage_ticks: 3 })).toEqual({ price: 21.4, quality: 'quote' });
  });
  it('a missing ask makes a buy use LTP plus the fallback percent and say so; a missing bid does the same for a sell', () => {
    expect(fillPrice(row({ bid: 99 }), 'buy', fills)).toEqual({ price: 102, quality: 'ltp_fallback' });
    expect(fillPrice(row({ ask: 101 }), 'sell', fills)).toEqual({ price: 98, quality: 'ltp_fallback' });
  });
  it('a buy with only a bid still falls back, because the bid is not the price it would pay', () => {
    expect(fillPrice(row({ bid: 99 }), 'buy', fills)?.quality).toBe('ltp_fallback');
  });
  it('with no quote and no LTP there is no price: null, never an invented one', () => {
    expect(fillPrice(row({ ltp: null }), 'buy', fills)).toBeNull();
  });
  it('a buy whose fallback price would be below one tick is no fill: a worthless option is not a trade', () => {
    expect(fillPrice(row({ ltp: 0.03 }), 'buy', fills)).toBeNull();
    expect(fillPrice(row({ ltp: 0.05 }), 'buy', fills)).toEqual({ price: 0.05, quality: 'ltp_fallback' });
  });
  it('a sell never fills below one tick', () => {
    expect(fillPrice(row({ bid: 0.05, ask: 0.1 }), 'sell', fills)).toEqual({ price: 0.05, quality: 'quote' });
  });
});
