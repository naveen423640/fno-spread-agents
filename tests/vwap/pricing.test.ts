import { describe, expect, it } from 'vitest';

import { bs } from '@/lib/screener/backtest';
import { futuresRoundTripCosts, sttSellPct } from '@/lib/vwap/backtest/costs';
import { DEFAULT_IV, priceTrade, realisedVol, type PricingContext } from '@/lib/vwap/backtest/pricing';
import { parseSymbolMaster, strikeStepNear } from '@/lib/vwap/backtest/symbol-master';
import type { RawTrade } from '@/lib/vwap/backtest/types';

const raw = (over: Partial<RawTrade> = {}): RawTrade => ({
  strategy: 's', symbol: 'NSE:TCS-EQ', sector: 'IT', day: '2026-10-07', month: '2026-10', direction: 1, signalType: 'close-cross', borderline: false,
  signalT: 0, signalDistancePct: 0.2, entryT: Date.parse('2026-10-07T10:00:00+05:30') / 1000, entryPrice: 100, exitT: Date.parse('2026-10-07T11:00:00+05:30') / 1000, exitPrice: 101,
  exitReason: 'square-off', maePct: -0.2, mfePct: 1.2, holdMinutes: 60, dayOfMonth: 7, sessionOfMonth: 4, ...over,
});
const ctx = (over: Partial<PricingContext> = {}): PricingContext => ({
  kind: 'futures', slippageBps: 0, capitalPerTrade: null, lots: new Map([['TCS', 100]]), strikes: new Map(), closes: new Map(), iv: DEFAULT_IV, riskFreeRate: 0.065, fallbackLot: null, minOptionPremium: 0, ...over,
});

describe('futures costs', () => {
  it('uses the 0.05% sell-side STT from 1 April 2026 and the old 0.02% before', () => {
    expect(sttSellPct('2026-03-31')).toBe(0.02);
    expect(sttSellPct('2026-04-01')).toBe(0.05);
    expect(sttSellPct('2026-10-07')).toBe(0.05);
  });

  it('adds up to a hand-computed total for a long: buy 100, sell 101, 100 shares', () => {
    const c = futuresRoundTripCosts({ entryFill: 100, exitFill: 101, qty: 100, direction: 1, date: '2026-10-07' });
    // turnover: buy 10,000 + sell 10,100 = 20,100
    expect(c.brokerage).toBe(40);
    expect(c.exchange).toBeCloseTo(20_100 * 0.0019 / 100, 10); // 0.3819
    expect(c.sebi).toBeCloseTo(20_100 * 0.0001 / 100, 10); // 0.0201
    expect(c.stt).toBeCloseTo(10_100 * 0.05 / 100, 10); // 5.05, sell leg only
    expect(c.stamp).toBeCloseTo(10_000 * 0.002 / 100, 10); // 0.20, buy leg only
    expect(c.gst).toBeCloseTo(0.18 * (40 + 0.3819 + 0.0201), 10); // 7.27236
    expect(c.total).toBeCloseTo(40 + 0.3819 + 0.0201 + 5.05 + 0.2 + 7.27236, 8);
  });

  it('for a short, the sell leg is the entry and the buy leg the exit', () => {
    const c = futuresRoundTripCosts({ entryFill: 101, exitFill: 100, qty: 100, direction: -1, date: '2026-10-07' });
    expect(c.stt).toBeCloseTo(10_100 * 0.05 / 100, 10);
    expect(c.stamp).toBeCloseTo(10_000 * 0.002 / 100, 10);
  });
});

describe('futures pricing', () => {
  it('long: gross P&L is the price difference times the quantity; net subtracts the costs', () => {
    const t = priceTrade(raw(), ctx())!;
    expect(t.qty).toBe(100);
    expect(t.grossPnl).toBeCloseTo(100, 10);
    expect(t.netPnl).toBeCloseTo(100 - 52.92436, 4);
    expect(t.netPct).toBeCloseTo(((100 - 52.92436) / 10_000) * 100, 6);
    expect(t.modelled).toBe(false);
  });

  it('short: profit when the price falls', () => {
    const t = priceTrade(raw({ direction: -1, entryPrice: 100, exitPrice: 99 }), ctx())!;
    expect(t.grossPnl).toBeCloseTo(100, 10);
  });

  it('slippage is adverse on both legs for longs and shorts', () => {
    const long = priceTrade(raw(), ctx({ slippageBps: 10 }))!;
    expect(long.entryFill).toBeCloseTo(100.1, 10);
    expect(long.exitFill).toBeCloseTo(101 * 0.999, 10);
    const short = priceTrade(raw({ direction: -1, entryPrice: 100, exitPrice: 99 }), ctx({ slippageBps: 10 }))!;
    expect(short.entryFill).toBeCloseTo(99.9, 10);
    expect(short.exitFill).toBeCloseTo(99 * 1.001, 10);
    expect(long.grossPnl).toBeLessThan(100);
  });

  it('sizes lots from a capital budget, at least one lot', () => {
    expect(priceTrade(raw(), ctx({ capitalPerTrade: 55_000 }))!.lots).toBe(5); // 55,000 / (100 x 100)
    expect(priceTrade(raw(), ctx({ capitalPerTrade: 100 }))!.lots).toBe(1);
  });

  it('drops a trade with no known lot size unless a fallback is given', () => {
    expect(priceTrade(raw({ symbol: 'NSE:UNKNOWN-EQ' }), ctx())).toBeNull();
    expect(priceTrade(raw({ symbol: 'NSE:UNKNOWN-EQ' }), ctx({ fallbackLot: 1 }))!.lot).toBe(1);
  });
});

describe('option pricing (modelled)', () => {
  const strikes = [90, 95, 100, 105, 110, 115];
  const optionCtx = (over: Partial<PricingContext> = {}) => ctx({ kind: 'option', strikes: new Map([['TCS', strikes]]), ...over });

  it('buys a call one strike above the money after an up-cross, priced by Black-Scholes, and marks it modelled', () => {
    const t = priceTrade(raw(), optionCtx())!;
    expect(t.modelled).toBe(true);
    expect(t.option).toMatchObject({ type: 'CE', strike: 105, step: 5, ivSource: 'fallback' });
    const left = (Date.parse('2026-10-27T00:00:00Z') - Date.parse('2026-10-07T00:00:00Z')) / 86_400_000;
    const sessionDone = (45 / 375); // 10:00 is 45 minutes into the session
    const expected = Math.round(bs(100, 105, (left - sessionDone) / 365, 0.3, true, 0.065) / 0.05) * 0.05;
    expect(t.option!.entryPremium).toBeCloseTo(expected, 8);
    expect(t.option!.exitPremium).toBeGreaterThan(t.option!.entryPremium); // spot rose 1%
    expect(t.grossPnl).toBeGreaterThan(0);
  });

  it('buys a put one strike below the money after a down-cross', () => {
    const t = priceTrade(raw({ direction: -1, exitPrice: 99 }), optionCtx())!;
    expect(t.option).toMatchObject({ type: 'PE', strike: 95 });
    expect(t.grossPnl).toBeGreaterThan(0);
  });

  it('a falling price loses money on the call, and the loss is limited to the premium paid', () => {
    const t = priceTrade(raw({ exitPrice: 90 }), optionCtx())!;
    expect(t.grossPnl).toBeLessThan(0);
    expect(t.grossPnl).toBeGreaterThanOrEqual(-t.entryFill * t.qty);
  });

  it('uses realised volatility when there is enough history, floored', () => {
    const closes = new Map<string, number>();
    let price = 100;
    for (let i = 0; i < 30; i += 1) { price *= i % 2 ? 1.02 : 0.98; closes.set(`2026-09-${String(i + 1).padStart(2, '0')}`, price); }
    const vol = realisedVol(closes, '2026-10-07', 20)!;
    expect(vol).toBeGreaterThan(0.3); // alternating 2% moves: 0.02 x sqrt(252) is about 0.32
    expect(vol).toBeLessThan(0.35);
    const t = priceTrade(raw(), optionCtx({ closes: new Map([['NSE:TCS-EQ', closes]]) }))!;
    expect(t.option!.ivSource).toBe('realised');
    expect(t.option!.iv).toBeCloseTo(vol, 8);
    expect(realisedVol(new Map([['2026-09-01', 100]]), '2026-10-07', 20)).toBeNull();
  });

  it('drops an option whose premium is below the minimum', () => {
    expect(priceTrade(raw(), optionCtx({ minOptionPremium: 1000 }))).toBeNull();
  });

  it('cannot price a trade without a strike grid', () => {
    expect(priceTrade(raw(), ctx({ kind: 'option' }))).toBeNull();
  });
});

describe('symbol master', () => {
  const line = (desc: string, lot: number, ticker: string, underlying: string, strike: number, type: string) => ['101126', desc, 13, lot, 0.05, '', '0915-1540', '2026-10-09', 1793095800, ticker, 10, 11, 49013, underlying, 11536, strike, type, '1010', 'None', 0, 0].join(',');
  const csv = [
    line('TCS 27 Oct 26 FUT', 225, 'NSE:TCS26OCTFUT', 'TCS', -1, 'XX'),
    line('TCS 27 Oct 26 3900 CE', 225, 'NSE:TCS26OCT3900CE', 'TCS', 3900, 'CE'),
    line('TCS 27 Oct 26 3950 CE', 225, 'NSE:TCS26OCT3950CE', 'TCS', 3950, 'CE'),
    line('TCS 27 Oct 26 4000 CE', 225, 'NSE:TCS26OCT4000CE', 'TCS', 4000, 'CE'),
    line('TCS 27 Oct 26 4100 CE', 225, 'NSE:TCS26OCT4100CE', 'TCS', 4100, 'CE'),
    line('TCS 24 Nov 26 4000 CE', 225, 'NSE:TCS26NOV4000CE', 'TCS', 4000, 'CE'),
    'short,line',
  ].join('\n');
  it('reads lot sizes, the nearest expiry strikes and ignores malformed lines', () => {
    const m = parseSymbolMaster(csv);
    expect(m.lots.get('TCS')).toBe(225);
    expect(m.expiry.get('TCS')).toBe('2026-10-27');
    expect(m.strikes.get('TCS')).toEqual([3900, 3950, 4000, 4100]);
  });
  it('takes the strike step from the strikes around the spot, not the sparse far ones', () => {
    expect(strikeStepNear([3900, 3950, 4000, 4100, 4300, 4500], 3960)).toBe(50);
    expect(strikeStepNear([3900, 4000], 3960)).toBeNull();
  });
});
