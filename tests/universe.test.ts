import { describe, expect, it } from 'vitest';

import type { MarketStock } from '@/lib/market-snapshot';
import { resolveUniverse } from '@/lib/universe';

const stock = (ticker: string, name = ticker): MarketStock => ({ symbol: `NSE:${ticker}-EQ`, ticker, name, price: 10, change: 1, changePct: 10, previousClose: 9 });
const snapshot = [stock('SBIN', 'STATE BANK'), stock('TCS', 'TATA CONSULTANCY'), stock('OLDCO', 'OLD CO')];

describe('resolveUniverse', () => {
  it('uses the engine list when available and keeps names from the snapshot', () => {
    const result = resolveUniverse(snapshot, { date: '2026-09-29', entries: [{ ticker: 'SBIN', lotSize: 750 }, { ticker: 'TCS', lotSize: 175 }] });
    expect(result.source).toBe('engine');
    expect(result.stocks.map((s) => s.ticker)).toEqual(['SBIN', 'TCS']);
    expect(result.stocks[0].name).toBe('STATE BANK');
    expect(result.date).toBe('2026-09-29');
    expect(result.note).toMatch(/2026-09-29/);
  });

  it('drops snapshot stocks that left the F&O list (a stock removed from F&O disappears)', () => {
    const result = resolveUniverse(snapshot, { date: '2026-09-29', entries: [{ ticker: 'SBIN', lotSize: 750 }] });
    expect(result.stocks.map((s) => s.ticker)).not.toContain('OLDCO');
  });

  it('adds a newly listed F&O stock the snapshot has never seen, using its ticker as the name', () => {
    const result = resolveUniverse(snapshot, { date: '2026-09-29', entries: [{ ticker: 'NEWCO', lotSize: 100 }] });
    expect(result.stocks).toEqual([expect.objectContaining({ ticker: 'NEWCO', symbol: 'NSE:NEWCO-EQ', name: 'NEWCO' })]);
  });

  it('falls back to the static list with a visible note when the engine is unavailable', () => {
    const result = resolveUniverse(snapshot, null);
    expect(result.source).toBe('static');
    expect(result.stocks).toEqual(snapshot);
    expect(result.note).toMatch(/engine unavailable/i);
    expect(result.note).toMatch(/static/i);
  });

  it('treats an empty engine list as unavailable rather than showing an empty heat map', () => {
    expect(resolveUniverse(snapshot, { date: '2026-09-29', entries: [] }).source).toBe('static');
  });
});
