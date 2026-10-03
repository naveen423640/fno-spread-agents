import { describe, expect, it } from 'vitest';

import { createLimiter } from './limits';
import type { ProviderConfig } from './types';

const provider: ProviderConfig = { name: 'alpha', baseUrl: 'https://x', apiKey: 'k', model: 'm', requestsPerMinute: 2, dailyTokenQuota: 1_000, costPer1kTokensInr: 0 };

describe('createLimiter', () => {
  it('rate-limits to requestsPerMinute on a sliding window', () => {
    let now = Date.parse('2026-10-03T05:00:00Z');
    const limiter = createLimiter(() => now);
    expect(limiter.tryAcquire(provider)).toBe('ok');
    expect(limiter.tryAcquire(provider)).toBe('ok');
    expect(limiter.tryAcquire(provider)).toBe('RATE_LIMITED');
    now += 60_001;
    expect(limiter.tryAcquire(provider)).toBe('ok');
  });

  it('tracks providers independently', () => {
    const limiter = createLimiter(() => 0);
    limiter.tryAcquire(provider); limiter.tryAcquire(provider);
    expect(limiter.tryAcquire({ ...provider, name: 'beta' })).toBe('ok');
  });

  it('refuses once the daily token quota is used, and resets at IST midnight', () => {
    let now = Date.parse('2026-10-03T18:29:00Z'); // 23:59 IST on 3 Oct
    const limiter = createLimiter(() => now);
    expect(limiter.tryAcquire(provider)).toBe('ok');
    limiter.recordTokens('alpha', 1_000);
    expect(limiter.tryAcquire(provider)).toBe('QUOTA_EXHAUSTED');
    now = Date.parse('2026-10-03T18:31:00Z'); // 00:01 IST on 4 Oct
    expect(limiter.tryAcquire(provider)).toBe('ok');
  });

  it('does not reset the quota inside the same IST day even across the UTC date change', () => {
    let now = Date.parse('2026-10-03T20:00:00Z'); // 01:30 IST on 4 Oct
    const limiter = createLimiter(() => now);
    limiter.recordTokens('alpha', 1_000);
    now = Date.parse('2026-10-03T23:59:00Z');
    expect(limiter.tryAcquire(provider)).toBe('QUOTA_EXHAUSTED');
  });
});
