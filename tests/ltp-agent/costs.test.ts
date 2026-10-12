import { describe, expect, it } from 'vitest';

import { chargesFor, type OrderLeg } from '@/lib/ltp-agent/costs';
import { lotSizeOn } from '@/lib/ltp-agent/config/lots';
import { ratesOn } from '@/lib/ltp-agent/config/costs';

const rates = ratesOn('2026-10-12', 'NSE'); // brokerage 20/order, STT 0.15% on premium sold, exchange 0.0355299%, SEBI Rs 10/crore, GST 18%, stamp 0.003% on buys

describe('charges, hand-computed to the paisa', () => {
  it('one BUY-book round trip: buy 65 at 100, sell 65 at 120', () => {
    const legs: OrderLeg[] = [{ side: 'buy', price: 100, qty: 65 }, { side: 'sell', price: 120, qty: 65 }];
    // turnover 6500 + 7800 = 14300
    // brokerage 2 x 20 = 40.00 | STT 7800 x 0.0015 = 11.70 | exchange 14300 x 0.000355299 = 5.0808 -> 5.08 | SEBI 14300 x 0.000001 = 0.0143 -> 0.01
    // GST 0.18 x (40 + 5.0808 + 0.0143) = 8.1171 -> 8.12 | stamp 6500 x 0.00003 = 0.195 -> 0.20
    expect(chargesFor(legs, rates)).toEqual({ brokerage: 40, stt: 11.7, exchange: 5.08, sebi: 0.01, gst: 8.12, stamp: 0.2, total: 65.11 });
  });

  it('one SELL-book round trip, four orders: sell 65 at 50, buy hedge 65 at 20, buy back 65 at 30, sell hedge 65 at 10', () => {
    const legs: OrderLeg[] = [{ side: 'sell', price: 50, qty: 65 }, { side: 'buy', price: 20, qty: 65 }, { side: 'buy', price: 30, qty: 65 }, { side: 'sell', price: 10, qty: 65 }];
    // turnover 3250 + 1300 + 1950 + 650 = 7150; sells 3250 + 650 = 3900; buys 1300 + 1950 = 3250
    // brokerage 4 x 20 = 80.00 | STT 3900 x 0.0015 = 5.85 | exchange 7150 x 0.000355299 = 2.5404 -> 2.54 | SEBI 0.00715 -> 0.01
    // GST 0.18 x (80 + 2.5404 + 0.00715) = 14.8586 -> 14.86 | stamp 3250 x 0.00003 = 0.0975 -> 0.10
    expect(chargesFor(legs, rates)).toEqual({ brokerage: 80, stt: 5.85, exchange: 2.54, sebi: 0.01, gst: 14.86, stamp: 0.1, total: 103.36 });
  });

  it('an option exercised in the money adds STT on its intrinsic value only: 30 x 65 x 0.00125 = 2.4375 -> 2.44', () => {
    const base = chargesFor([{ side: 'buy', price: 100, qty: 65 }], rates);
    const exercised = chargesFor([{ side: 'buy', price: 100, qty: 65 }], rates, { exercise: { intrinsic: 30, qty: 65 } });
    expect(exercised.stt).toBe(2.44);
    expect(exercised.total).toBeCloseTo(base.total + 2.44, 2);
  });

  it('no legs costs nothing', () => {
    expect(chargesFor([], rates).total).toBe(0);
  });
});

describe('rates are dated', () => {
  it('STT on option sales was 0.1% before 2026-04-01 and 0.15% from then', () => {
    expect(ratesOn('2026-03-31', 'NSE').sttSell).toBe(0.001);
    expect(ratesOn('2026-04-01', 'NSE').sttSell).toBe(0.0015);
  });
  it('a date before the first effective date is an error, not a guess', () => {
    expect(() => ratesOn('2020-01-01', 'NSE')).toThrow(/2020-01-01/);
  });
  it('BSE has its own exchange transaction rate', () => {
    expect(ratesOn('2026-10-12', 'BSE').exchange).not.toBe(ratesOn('2026-10-12', 'NSE').exchange);
  });
});

describe('lot sizes are dated, never hardcoded', () => {
  it('2026-10-12: NIFTY 65, BANKNIFTY 30, SENSEX 20', () => {
    expect(lotSizeOn('NSE:NIFTY50-INDEX', '2026-10-12')).toBe(65);
    expect(lotSizeOn('NSE:NIFTYBANK-INDEX', '2026-10-12')).toBe(30);
    expect(lotSizeOn('BSE:SENSEX-INDEX', '2026-10-12')).toBe(20);
  });
  it('a date before the table starts, or an unknown underlying, throws', () => {
    expect(() => lotSizeOn('NSE:NIFTY50-INDEX', '2020-01-01')).toThrow(/2020-01-01/);
    expect(() => lotSizeOn('NSE:UNKNOWN', '2026-10-12')).toThrow(/UNKNOWN/);
  });
});
