import { describe, expect, it } from 'vitest';

import { createLlmClient, createReplayClient, hashPrompt } from './client';
import { createLimiter } from './limits';
import type { CallLogEntry, LlmRequest, ProviderConfig } from './types';

const provider = (name: string, extra: Partial<ProviderConfig> = {}): ProviderConfig => ({ name, baseUrl: `https://${name}.example/v1`, apiKey: `key-for-${name}-9f3a`, model: `${name}-model`, requestsPerMinute: 5, dailyTokenQuota: 100_000, costPer1kTokensInr: 0, ...extra });
const request: LlmRequest = { role: 'technical', runId: 'r1', messages: [{ role: 'user', content: 'hello' }], maxTokens: 100 };
const okBody = (text: string) => JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 12, completion_tokens: 8 } });

function setup(providers: ProviderConfig[], handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const logs: CallLogEntry[] = [];
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push(url); return handler(url, init); }) as unknown as typeof fetch;
  const client = createLlmClient({ providers, limiter: createLimiter(() => 0), log: async (entry) => { logs.push(entry); }, fetchImpl, now: () => 0 });
  return { client, logs, calls };
}

describe('createLlmClient', () => {
  it('returns the text and logs a successful call with zero cost for a free provider', async () => {
    const { client, logs } = setup([provider('alpha')], () => new Response(okBody('hi')));
    const result = await client.complete(request);
    expect(result).toEqual({ ok: true, text: 'hi', provider: 'alpha', model: 'alpha-model', tokensIn: 12, tokensOut: 8 });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ runId: 'r1', role: 'technical', provider: 'alpha', tokensIn: 12, tokensOut: 8, costInr: 0, status: 'ok' });
    expect(logs[0].promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computes cost from tokens for a paid provider', async () => {
    const { client, logs } = setup([provider('paid', { costPer1kTokensInr: 5 })], () => new Response(okBody('hi')));
    await client.complete(request);
    expect(logs[0].costInr).toBeCloseTo(0.1, 6);
  });

  it('falls back to the next provider on 429 and logs both attempts', async () => {
    const { client, logs, calls } = setup([provider('alpha'), provider('beta')], (url) => url.includes('alpha') ? new Response('slow down', { status: 429 }) : new Response(okBody('from beta')));
    const result = await client.complete(request);
    expect(result).toMatchObject({ ok: true, text: 'from beta', provider: 'beta' });
    expect(calls).toHaveLength(2);
    expect(logs.map((entry) => [entry.provider, entry.status])).toEqual([['alpha', 'http_429'], ['beta', 'ok']]);
  });

  it('falls back on a network error and on a body with no content', async () => {
    const { client } = setup([provider('alpha'), provider('beta'), provider('gamma')], (url) => {
      if (url.includes('alpha')) throw new Error('socket hang up');
      if (url.includes('beta')) return new Response(JSON.stringify({ choices: [] }));
      return new Response(okBody('from gamma'));
    });
    expect(await client.complete(request)).toMatchObject({ ok: true, provider: 'gamma' });
  });

  it('returns RATE_LIMITED without any network call when the limiter refuses everyone', async () => {
    const { client, calls } = setup([provider('alpha', { requestsPerMinute: 1 })], () => new Response(okBody('x')));
    await client.complete(request);
    calls.length = 0;
    const result = await client.complete(request);
    expect(result).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
    expect(calls).toHaveLength(0);
  });

  it('returns QUOTA_EXHAUSTED once the daily token quota is spent', async () => {
    const { client } = setup([provider('alpha', { dailyTokenQuota: 20 })], () => new Response(okBody('x')));
    await client.complete(request); // uses 20 tokens
    expect(await client.complete(request)).toMatchObject({ ok: false, error: 'QUOTA_EXHAUSTED' });
  });

  it('returns PROVIDER_ERROR when every provider fails, and PROVIDER_ERROR with no providers', async () => {
    const failing = setup([provider('alpha')], () => new Response('boom', { status: 500 }));
    expect(await failing.client.complete(request)).toMatchObject({ ok: false, error: 'PROVIDER_ERROR' });
    const none = setup([], () => new Response(okBody('x')));
    expect(await none.client.complete(request)).toMatchObject({ ok: false, error: 'PROVIDER_ERROR' });
  });

  it('never puts the api key in a log entry or an error detail', async () => {
    const key = provider('alpha').apiKey;
    const { client, logs } = setup([provider('alpha')], () => { throw new Error(`request to https://alpha.example failed with Bearer ${key}`); });
    const result = await client.complete(request);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(logs)).not.toContain(key);
  });

  it('sends the key only in the Authorization header', async () => {
    let seen: RequestInit | undefined;
    const { client } = setup([provider('alpha')], (_url, init) => { seen = init; return new Response(okBody('x')); });
    await client.complete(request);
    expect((seen?.headers as Record<string, string>).Authorization).toBe('Bearer key-for-alpha-9f3a');
    expect(String(seen?.body)).not.toContain('key-for-alpha');
  });
});

describe('createReplayClient', () => {
  it('returns the fixture for a matching prompt hash, logs it, and misses otherwise', async () => {
    const logs: CallLogEntry[] = [];
    const hash = await hashPrompt(request.messages);
    const client = createReplayClient({ [hash]: 'recorded' }, async (entry) => { logs.push(entry); });
    expect(await client.complete(request)).toMatchObject({ ok: true, text: 'recorded', provider: 'replay' });
    expect(logs[0]).toMatchObject({ provider: 'replay', costInr: 0, promptHash: hash });
    const miss = await client.complete({ ...request, messages: [{ role: 'user', content: 'other' }] });
    expect(miss).toMatchObject({ ok: false, error: 'REPLAY_MISS' });
  });
});
