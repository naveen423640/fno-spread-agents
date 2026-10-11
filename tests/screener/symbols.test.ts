import { describe, expect, it } from 'vitest';

import { expiryParts, fmtStrike, fyersEquity, fyersIndex, fyersOption, kiteEquity, kiteIndex, kiteOption, monthlyExpiry, parseSymbolMasterLots } from '../../lib/screener/symbols';
import { loadGolden } from '../support/screener-golden';

const golden = loadGolden();

describe('monthlyExpiry (last Tuesday of the month) matches the reference', () => {
  it.each(golden.expiry.map((c) => [c.today, c.expiry] as const))('today %s -> %s', (today, expiry) => {
    expect(monthlyExpiry(today)).toBe(expiry);
  });

  it('is the same day when today is the expiry, and the next month once it has passed', () => {
    expect(monthlyExpiry('2026-10-27')).toBe('2026-10-27');
    expect(monthlyExpiry('2026-10-28')).toBe('2026-11-24');
  });

  it('rolls into the next year from December', () => {
    expect(monthlyExpiry('2026-12-30')).toBe('2027-01-26');
  });

  it('always lands on a Tuesday', () => {
    for (let m = 1; m <= 12; m += 1) {
      const day = new Date(`${monthlyExpiry(`2027-${String(m).padStart(2, '0')}-03`)}T00:00:00Z`).getUTCDay();
      expect(day).toBe(2);
    }
  });
});

describe('strike formatting follows Python :g', () => {
  it.each([[1200, '1200'], [4800.0, '4800'], [3250.5, '3250.5'], [100, '100'], [97.5, '97.5'], [12345.67, '12345.7']] as const)('%s -> %s', (strike, text) => {
    expect(fmtStrike(strike)).toBe(text);
  });
});

describe('Fyers symbols', () => {
  it('builds equity and index symbols', () => {
    expect(fyersEquity('RELIANCE')).toBe('NSE:RELIANCE-EQ');
    expect(fyersEquity('M&M')).toBe('NSE:M&M-EQ');
    expect(fyersIndex()).toBe('NSE:NIFTY50-INDEX');
  });

  it.each(golden.fy_opt.map((c) => [c] as const))('option symbol matches the reference: %j', (c) => {
    expect(fyersOption(c.sym, c.yy, c.mon, c.strike, c.cp)).toBe(c.out);
  });

  it('the documented example', () => {
    expect(fyersOption('RELIANCE', 26, 'OCT', 1200, 'PE')).toBe('NSE:RELIANCE26OCT1200PE');
  });
});

describe('Kite symbols', () => {
  it('builds equity, index and option symbols in the documented formats', () => {
    expect(kiteEquity('RELIANCE')).toBe('NSE:RELIANCE');
    expect(kiteIndex()).toBe('NSE:NIFTY 50');
    expect(kiteOption('APOLLOHOSP', 26, 'OCT', 8000, 'CE')).toBe('NFO:APOLLOHOSP26OCT8000CE');
    expect(kiteOption('RELIANCE', 26, 'oct', 1200, 'pe')).toBe('NFO:RELIANCE26OCT1200PE');
  });
});

describe('expiryParts', () => {
  it('splits an ISO expiry into the two-digit year and month code', () => {
    expect(expiryParts('2026-10-27')).toEqual({ yy: 26, mon: 'OCT' });
    expect(expiryParts('2027-01-26')).toEqual({ yy: 27, mon: 'JAN' });
  });
});

describe('parseSymbolMasterLots (Fyers NSE_FO.csv: symbol in column 9, lot size in column 3)', () => {
  const csv = [
    '1000000000001,HAL 26OCT 4800 CE,14,150,0.05,ISIN,0,09:15-15:30,2026-10-26,NSE:HAL26OCT4800CE,10,HAL,1,1,0',
    '1000000000002,HAL 26OCT 5100 CE,14,150,0.05,ISIN,0,09:15-15:30,2026-10-26,NSE:HAL26OCT5100CE,10,HAL,1,1,0',
    '1000000000003,RELIANCE 26OCT 1200 PE,14,500,0.05,ISIN,0,09:15-15:30,2026-10-26,NSE:RELIANCE26OCT1200PE,10,RELIANCE,1,1,0',
    'broken,row',
    '',
    '1000000000004,BAD LOT,14,notanumber,0.05,ISIN,0,09:15-15:30,2026-10-26,NSE:BAD26OCT100CE,10,BAD,1,1,0',
  ].join('\n');

  it('maps ticker to lot size, skipping blank, short and non-numeric rows', () => {
    const lots = parseSymbolMasterLots(csv);
    expect(lots.get('NSE:HAL26OCT4800CE')).toBe(150);
    expect(lots.get('NSE:RELIANCE26OCT1200PE')).toBe(500);
    expect(lots.has('NSE:BAD26OCT100CE')).toBe(false);
    expect(lots.size).toBe(3);
  });

  it('handles Windows line endings', () => {
    expect(parseSymbolMasterLots(csv.replace(/\n/g, '\r\n')).get('NSE:HAL26OCT5100CE')).toBe(150);
  });
});
