import { describe, expect, it } from 'vitest';

import { parseProviders } from './config';

const entry = { name: 'alpha', baseUrl: 'https://alpha.example/v1', apiKeyEnv: 'ALPHA_KEY', model: 'm1', requestsPerMinute: 10, dailyTokenQuota: 100_000 };

describe('parseProviders', () => {
  it('resolves api keys from the injected env and defaults cost to zero', () => {
    const providers = parseProviders({ LLM_PROVIDERS: JSON.stringify([entry]), ALPHA_KEY: 'secret-value' });
    expect(providers).toEqual([{ name: 'alpha', baseUrl: 'https://alpha.example/v1', apiKey: 'secret-value', model: 'm1', requestsPerMinute: 10, dailyTokenQuota: 100_000, costPer1kTokensInr: 0 }]);
  });

  it('skips a provider whose key is missing and keeps the order of the rest', () => {
    const second = { ...entry, name: 'beta', apiKeyEnv: 'BETA_KEY' };
    const providers = parseProviders({ LLM_PROVIDERS: JSON.stringify([entry, second]), BETA_KEY: 'b' });
    expect(providers.map((p) => p.name)).toEqual(['beta']);
  });

  it('returns no providers when LLM_PROVIDERS is unset', () => {
    expect(parseProviders({})).toEqual([]);
  });

  it('throws a clear error on malformed JSON or a bad entry', () => {
    expect(() => parseProviders({ LLM_PROVIDERS: '{nope' })).toThrow(/LLM_PROVIDERS/);
    expect(() => parseProviders({ LLM_PROVIDERS: JSON.stringify([{ name: 'x' }]) })).toThrow(/LLM_PROVIDERS/);
  });

  it('never leaks the key into an error message', () => {
    try { parseProviders({ LLM_PROVIDERS: JSON.stringify([{ ...entry, requestsPerMinute: 'many' }]), ALPHA_KEY: 'secret-value' }); } catch (error) {
      expect(String(error)).not.toContain('secret-value');
    }
  });
});
