import { describe, expect, it } from 'vitest';

import type { MarketStock } from '@/lib/market-snapshot';
import { resolveUniverse, withoutPlaceholders } from '@/lib/universe';

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

describe('withoutPlaceholders', () => {
  const real = stock('SBIN');
  const placeholder = (ticker: string): MarketStock => ({ symbol: `NSE:${ticker}-EQ`, ticker, name: ticker, price: 0, change: 0, changePct: 0, previousClose: 0 });

  it('removes zero-quote placeholders, keeps real stocks and counts the hidden ones', () => {
    const result = withoutPlaceholders([real, placeholder('NEWCO'), placeholder('NEW2')]);
    expect(result.stocks).toEqual([real]);
    expect(result.hidden).toBe(2);
  });

  it('keeps a stock with only one of price or previousClose at zero', () => {
    const a = { ...placeholder('A'), previousClose: 5 };
    const b = { ...placeholder('B'), price: 5 };
    expect(withoutPlaceholders([a, b])).toEqual({ stocks: [a, b], hidden: 0 });
  });

  it('handles empty input', () => {
    expect(withoutPlaceholders([])).toEqual({ stocks: [], hidden: 0 });
  });

  it('resolveUniverse then withoutPlaceholders yields only real-quote stocks for an unknown ticker', () => {
    const resolved = resolveUniverse(snapshot, { date: '2026-09-29', entries: [{ ticker: 'SBIN', lotSize: 750 }, { ticker: 'NEWCO', lotSize: 100 }] });
    const result = withoutPlaceholders(resolved.stocks);
    expect(result.stocks.map((s) => s.ticker)).toEqual(['SBIN']);
    expect(result.hidden).toBe(1);
  });
});
