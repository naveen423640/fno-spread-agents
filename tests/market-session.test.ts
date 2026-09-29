import { describe, expect, it } from 'vitest';

import { previousTradingDate } from '@/lib/market-session';

// 2026-09-25 is a Friday, 09-28 a Monday, 09-29 a Tuesday, 09-30 a Wednesday.
describe('previousTradingDate', () => {
  it('returns the prior weekday on a Tuesday morning', () => {
    expect(previousTradingDate(new Date('2026-09-29T04:30:00Z'))).toBe('2026-09-28');
  });

  it('skips the weekend on a Monday', () => {
    expect(previousTradingDate(new Date('2026-09-28T04:30:00Z'))).toBe('2026-09-25');
  });

  it('skips the weekend when called on a Sunday', () => {
    expect(previousTradingDate(new Date('2026-09-27T06:00:00Z'))).toBe('2026-09-25');
  });

  it('uses the India date, not the UTC date, just after midnight IST', () => {
    // 00:01 IST on Wed 30 Sep is still 29 Sep in UTC.
    expect(previousTradingDate(new Date('2026-09-29T18:31:00Z'))).toBe('2026-09-29');
  });

  it('skips exchange holidays', () => {
    expect(previousTradingDate(new Date('2026-09-29T04:30:00Z'), new Set(['2026-09-28']))).toBe('2026-09-25');
  });
});
