import type { ProviderConfig } from './types';

const IST_OFFSET_MS = 5.5 * 3_600_000;
const MINUTE_MS = 60_000;

export type Limiter = {
  tryAcquire(provider: ProviderConfig): 'ok' | 'RATE_LIMITED' | 'QUOTA_EXHAUSTED';
  recordTokens(providerName: string, tokens: number): void;
};

const istDay = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

export function createLimiter(now: () => number): Limiter {
  const requests = new Map<string, number[]>();
  const usage = new Map<string, { day: string; tokens: number }>();

  function tokensToday(name: string) {
    const day = istDay(now());
    const entry = usage.get(name);
    if (!entry || entry.day !== day) { usage.set(name, { day, tokens: 0 }); return 0; }
    return entry.tokens;
  }

  return {
    tryAcquire(provider) {
      if (tokensToday(provider.name) >= provider.dailyTokenQuota) return 'QUOTA_EXHAUSTED';
      const current = now();
      const recent = (requests.get(provider.name) ?? []).filter((at) => current - at < MINUTE_MS);
      if (recent.length >= provider.requestsPerMinute) { requests.set(provider.name, recent); return 'RATE_LIMITED'; }
      recent.push(current);
      requests.set(provider.name, recent);
      return 'ok';
    },
    recordTokens(providerName, tokens) {
      const used = tokensToday(providerName);
      usage.set(providerName, { day: istDay(now()), tokens: used + tokens });
    },
  };
}
