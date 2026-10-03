import { describe, expect, it } from 'vitest';

import { describeProviders, parseProviders } from './config';

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

  it('accepts a list of env var names and uses the first one that is set', () => {
    const entry2 = { ...entry, apiKeyEnv: ['ALPHA_KEY', 'ALPHA_KEY_ALT'] };
    expect(parseProviders({ LLM_PROVIDERS: JSON.stringify([entry2]), ALPHA_KEY_ALT: 'alt-value' })[0].apiKey).toBe('alt-value');
    expect(parseProviders({ LLM_PROVIDERS: JSON.stringify([entry2]), ALPHA_KEY: 'first', ALPHA_KEY_ALT: 'alt-value' })[0].apiKey).toBe('first');
  });

  it('falls back to the committed default provider list when LLM_PROVIDERS is unset', () => {
    const providers = parseProviders({ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', XAI_API_KEY: 'x', DEEPSEEK_API_KEY: 'd', ANTHROPIC_API_KEY: 'a' });
    expect(providers.map((p) => p.name)).toEqual(['google', 'groq', 'deepseek', 'xai', 'anthropic']);
    expect(providers.every((p) => p.baseUrl.startsWith('https://') && p.model && p.requestsPerMinute > 0 && p.dailyTokenQuota > 0)).toBe(true);
  });

  it('uses only the defaults whose key is present, and an explicit LLM_PROVIDERS replaces the defaults', () => {
    expect(parseProviders({ DEEPSEEK_API_KEY: 'd' }).map((p) => p.name)).toEqual(['deepseek']);
    expect(parseProviders({ LLM_PROVIDERS: '[]', DEEPSEEK_API_KEY: 'd' })).toEqual([]);
  });
});

describe('describeProviders', () => {
  it('reports each configured provider with whether a key is present, never the key', () => {
    const report = describeProviders({ GEMINI_API_KEY: 'super-secret' });
    expect(report.find((p) => p.name === 'google')).toMatchObject({ keyPresent: true });
    expect(report.find((p) => p.name === 'deepseek')).toMatchObject({ keyPresent: false });
    expect(JSON.stringify(report)).not.toContain('super-secret');
  });
});
