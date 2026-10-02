import { describe, expect, it } from 'vitest';

import { strategyLabRequest } from '@/lib/strategy-lab-request';

const base = { ticker: 'SBIN', startDate: '2026-09-25', strategy: 'bull-call' };
const leg = { optionType: 'CE' as const, strike: 980, side: 1 as const, quantity: 1, symbol: 'NSE:SBIN26SEP980CE', entryPrice: 6.2 };

describe('strategyLabRequest', () => {
  it('sync without loaded legs omits legs so the server uses the strategy defaults', () => {
    const request = strategyLabRequest('sync', { ...base, legs: [] });
    expect(request).toEqual({ action: 'sync', ...base });
    expect(request && 'legs' in request).toBe(false);
  });

  it('sync with legs sends only the four fields the server accepts', () => {
    expect(strategyLabRequest('sync', { ...base, legs: [leg] })).toEqual({
      action: 'sync', ...base, legs: [{ optionType: 'CE', strike: 980, side: 1, quantity: 1 }],
    });
  });

  it('build with legs sends them; build without legs cannot be sent', () => {
    expect(strategyLabRequest('build', { ...base, legs: [leg] })).toMatchObject({ action: 'build', legs: [{ strike: 980 }] });
    expect(strategyLabRequest('build', { ...base, legs: [] })).toBeNull();
  });

  it('does not leak extra leg fields such as symbol or entryPrice', () => {
    const request = strategyLabRequest('build', { ...base, legs: [leg] });
    expect(JSON.stringify(request)).not.toContain('symbol');
    expect(JSON.stringify(request)).not.toContain('entryPrice');
  });
});
