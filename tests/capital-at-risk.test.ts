import { describe, expect, it } from 'vitest';

import { capitalAtRiskText, money } from '@/lib/money';
import { calculateRiskMetrics } from '@/lib/strategy-payoff';

describe('capital at risk display', () => {
  it('has no finite capital figure for a naked short call', () => {
    const metrics = calculateRiskMetrics([{ optionType: 'CE', strike: 100, side: -1, quantity: 1, entryPrice: 5 }], 50);
    expect(metrics.maxLoss).toBeNull();
    expect(metrics.estimatedCapital).toBeNull();
  });

  it('labels unlimited loss as Unlimited rather than zero', () => {
    expect(capitalAtRiskText(null)).toBe('Unlimited');
  });

  it('formats a finite figure in rupees', () => {
    expect(capitalAtRiskText(2663)).toBe('₹2,663');
    expect(money(-1200)).toBe('−₹1,200');
    expect(money(4838, true)).toBe('+₹4,838');
  });
});
