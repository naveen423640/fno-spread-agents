import { describe, expect, it } from 'vitest';

import { fetchEngineUniverse } from '@/lib/engine-client';

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('fetchEngineUniverse', () => {
  it('returns the universe from the engine and calls the right URL', async () => {
    let seen = '';
    const fetchImpl = (async (url: string) => { seen = String(url); return ok({ date: '2026-09-29', source: 'engine', entries: [{ ticker: 'SBIN', lotSize: 750 }] }); }) as unknown as typeof fetch;
    const result = await fetchEngineUniverse('latest', fetchImpl, 'http://127.0.0.1:8765');
    expect(seen).toBe('http://127.0.0.1:8765/universe/latest');
    expect(result).toEqual({ date: '2026-09-29', entries: [{ ticker: 'SBIN', lotSize: 750 }] });
  });

  it('returns null for 404, 500, malformed JSON, a rejecting fetch and a timeout, and never throws', async () => {
    const failures = [
      (async () => ok({ detail: 'none' }, 404)) as unknown as typeof fetch,
      (async () => ok({}, 500)) as unknown as typeof fetch,
      (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch,
      (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch,
      (async (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch,
    ];
    for (const fetchImpl of failures) expect(await fetchEngineUniverse('latest', fetchImpl, 'http://127.0.0.1:8765', 30)).toBeNull();
  });

  it('rejects a payload with the wrong shape', async () => {
    const fetchImpl = (async () => ok({ date: '2026-09-29', entries: 'nope' })) as unknown as typeof fetch;
    expect(await fetchEngineUniverse('latest', fetchImpl)).toBeNull();
  });
});
