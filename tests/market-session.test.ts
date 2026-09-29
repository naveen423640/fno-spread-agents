import { describe, expect, it } from 'vitest';

import { describeLiveFeed, lastCompletedSession, marketSession, previousTradingDate } from '@/lib/market-session';

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

describe('marketSession', () => {
  it('is open at 10:00 IST on a trading day', () => {
    expect(marketSession(new Date('2026-09-29T04:30:00Z'))).toBe('open');
  });

  it('is closed at 09:14 IST and open at 09:15 IST', () => {
    expect(marketSession(new Date('2026-09-29T03:44:00Z'))).toBe('closed');
    expect(marketSession(new Date('2026-09-29T03:45:00Z'))).toBe('open');
  });

  it('is open at 15:29 IST and closed at 15:30 IST', () => {
    expect(marketSession(new Date('2026-09-29T09:59:00Z'))).toBe('open');
    expect(marketSession(new Date('2026-09-29T10:00:00Z'))).toBe('closed');
  });

  it('is closed just after midnight IST', () => {
    expect(marketSession(new Date('2026-09-29T18:31:00Z'))).toBe('closed');
  });

  it('is closed on Saturday and on a listed holiday', () => {
    expect(marketSession(new Date('2026-09-26T04:30:00Z'))).toBe('closed');
    expect(marketSession(new Date('2026-09-29T04:30:00Z'), new Set(['2026-09-29']))).toBe('closed');
  });
});

describe('describeLiveFeed', () => {
  it('reports live with the current time while the market is open', () => {
    const now = new Date('2026-09-29T04:30:00Z');
    expect(describeLiveFeed(now)).toEqual({ source: 'FYERS live', asOf: now.toISOString(), live: true });
  });

  it('reports the previous close just after midnight IST', () => {
    const feed = describeLiveFeed(new Date('2026-09-29T18:31:00Z'));
    expect(feed.source).toBe('FYERS last close');
    expect(feed.live).toBe(false);
    expect(feed.asOf).toBe('2026-09-29T15:30:00+05:30');
  });

  it('reports the same-day close after the market closes', () => {
    expect(describeLiveFeed(new Date('2026-09-30T10:30:00Z')).asOf).toBe('2026-09-30T15:30:00+05:30');
  });

  it('reports the Friday close on a Monday before the open', () => {
    expect(describeLiveFeed(new Date('2026-09-28T02:30:00Z')).asOf).toBe('2026-09-25T15:30:00+05:30');
  });
});

describe('lastCompletedSession', () => {
  it('is the previous trading day while the market is open (today is still forming)', () => {
    expect(lastCompletedSession(new Date('2026-09-29T04:30:00Z'))).toBe('2026-09-28');
  });

  it('is the previous trading day at 15:29 IST and today at 15:30 IST', () => {
    expect(lastCompletedSession(new Date('2026-09-29T09:59:00Z'))).toBe('2026-09-28');
    expect(lastCompletedSession(new Date('2026-09-29T10:00:00Z'))).toBe('2026-09-29');
  });

  it('is today after 15:30 IST on a trading day', () => {
    expect(lastCompletedSession(new Date('2026-09-30T10:30:00Z'))).toBe('2026-09-30');
  });

  it('is the previous trading day just after midnight IST', () => {
    expect(lastCompletedSession(new Date('2026-09-29T18:31:00Z'))).toBe('2026-09-29');
  });

  it('is Friday over a weekend, including a Saturday evening', () => {
    expect(lastCompletedSession(new Date('2026-09-27T06:00:00Z'))).toBe('2026-09-25');
    expect(lastCompletedSession(new Date('2026-09-26T14:00:00Z'))).toBe('2026-09-25');
  });

  it('skips a listed holiday even after the close', () => {
    expect(lastCompletedSession(new Date('2026-09-30T10:30:00Z'), new Set(['2026-09-30']))).toBe('2026-09-29');
  });
});
