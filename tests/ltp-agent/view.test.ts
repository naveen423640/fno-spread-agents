import { describe, expect, it } from 'vitest';

import { equityCurve, heartbeatBadge, mtmOf } from '@/lib/ltp-agent/view';
import { summarizeTrades, type SummaryTrade } from '@/lib/ltp-agent/reviewer';
import type { Position } from '@/lib/ltp-agent/books';

describe('heartbeatBadge: green under 2 minutes, amber under 5, red otherwise or when there is no heartbeat', () => {
  it('boundaries', () => {
    expect(heartbeatBadge(0)).toBe('green');
    expect(heartbeatBadge(119)).toBe('green');
    expect(heartbeatBadge(120)).toBe('amber');
    expect(heartbeatBadge(299)).toBe('amber');
    expect(heartbeatBadge(300)).toBe('red');
    expect(heartbeatBadge(null)).toBe('red');
  });
});

describe('equityCurve is the running net P&L in close order', () => {
  it('cumulates, ordering by close time even if given shuffled', () => {
    const curve = equityCurve([{ ts: 30, net: -50 }, { ts: 10, net: 100 }, { ts: 20, net: 25 }]);
    expect(curve).toEqual([{ ts: 10, equity: 100 }, { ts: 20, equity: 125 }, { ts: 30, equity: 75 }]);
  });
  it('no trades gives an empty curve', () => {
    expect(equityCurve([])).toEqual([]);
  });
});

describe('mtmOf is the gross open P&L of a position before charges', () => {
  const position = (legs: Position['legs']): Position => ({ book: 'buy', underlying: 'u', expiry: 'e', direction: 'long', date: 'd', openedTs: 0, entrySpot: 0, qty: 65, legs, plannedRiskInr: 1, fillQuality: 'quote', maeSpot: 0, mfeSpot: 0, maeInr: 0, mfeInr: 0 });
  it('a bought leg gains when its LTP rises: (120 - 100.25) x 65', () => {
    expect(mtmOf(position([{ side: 'buy', optionSide: 'CE', strike: 1, entryPrice: 100.25, quality: 'quote', lastLtp: 120 }]))).toBeCloseTo(19.75 * 65, 6);
  });
  it('a spread sums its legs: sold 49.85 now 40, bought 20.15 now 25 gives (9.85 + 4.85) x 65', () => {
    expect(mtmOf(position([{ side: 'sell', optionSide: 'PE', strike: 1, entryPrice: 49.85, quality: 'quote', lastLtp: 40 }, { side: 'buy', optionSide: 'PE', strike: 2, entryPrice: 20.15, quality: 'quote', lastLtp: 25 }]))).toBeCloseTo(14.7 * 65, 6);
  });
});

describe('the breakdowns reconcile with the overall totals', () => {
  const trade = (id: string, o: Partial<SummaryTrade>): SummaryTrade => ({ decisionId: id, date: '2026-10-12', underlying: 'NSE:NIFTY50-INDEX', setup: 'coa1_reversal', scenario: 1, hit: 1, hhmm: '10:05', buy: 100, sell: 40, review: null, ...o });
  const s = summarizeTrades([trade('a', {}), trade('b', { setup: 'nine_twenty', scenario: 3, hit: 2, hhmm: '13:00', buy: -70, sell: -10 }), trade('c', { underlying: 'BSE:SENSEX-INDEX', hhmm: '14:30', buy: 20, sell: 5 })]);
  it('each grouping sums to the same buy and sell totals as the book comparison', () => {
    for (const group of [s.bySetup, s.byScenario, s.byHit, s.byTimeBucket, s.byUnderlying]) {
      expect(Object.values(group).reduce((a, g) => a + g.buyNet, 0)).toBe(s.byBook.buy.net);
      expect(Object.values(group).reduce((a, g) => a + g.sellNet, 0)).toBe(s.byBook.sell.net);
      expect(Object.values(group).reduce((a, g) => a + g.n, 0)).toBe(3);
    }
    expect(s.byBook.buy.net).toBe(50);
  });
});
