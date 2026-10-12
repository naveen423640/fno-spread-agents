import { describe, expect, it } from 'vitest';

import { createFyersAdapter } from '@/lib/screener/broker/fyers';

const creds = { clientId: 'app', accessToken: 'SECRET-TOKEN-123' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const okChain = { s: 'ok', data: { optionsChain: [], expiryData: [{ date: '13-10-2026' }] } };

function adapterWith(responses: Response[]) {
  const urls: string[] = [];
  const waits: number[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: URL | string) => { urls.push(String(input)); return queue.shift() ?? json({ s: 'error', message: 'out of responses' }, 500); }) as unknown as typeof fetch;
  return { adapter: createFyersAdapter({ credentials: creds, fetchImpl, sleep: async (ms) => { waits.push(ms); } }), urls, waits };
}

describe('FyersAdapter.optionChain', () => {
  it('requests the chain for the given underlying with the strike count', async () => {
    const { adapter, urls } = adapterWith([json(okChain)]);
    const r = await adapter.optionChain('NSE:NIFTY50-INDEX', 20);
    expect(r.ok).toBe(true);
    const u = new URL(urls[0]);
    expect(u.pathname).toBe('/data/options-chain-v3');
    expect(u.searchParams.get('symbol')).toBe('NSE:NIFTY50-INDEX');
    expect(u.searchParams.get('strikecount')).toBe('20');
  });

  it('defaults to 20 strikes and passes a BSE symbol through unchanged', async () => {
    const { adapter, urls } = adapterWith([json(okChain)]);
    await adapter.optionChain('BSE:SENSEX-INDEX');
    const u = new URL(urls[0]);
    expect(u.searchParams.get('symbol')).toBe('BSE:SENSEX-INDEX');
    expect(u.searchParams.get('strikecount')).toBe('20');
  });

  it('retries a transient failure with exponential backoff and then succeeds', async () => {
    const { adapter, urls, waits } = adapterWith([json({ s: 'error', message: 'rate limit' }, 429), json({}, 503), json(okChain)]);
    const r = await adapter.optionChain('NSE:NIFTY50-INDEX');
    expect(r.ok).toBe(true);
    expect(urls).toHaveLength(3);
    expect(waits).toEqual([500, 1000]);
  });

  it('gives up after repeated failures and returns an explicit error, never previous data', async () => {
    const { adapter, urls } = adapterWith([json({}, 500), json({}, 500), json({}, 500), json({}, 500)]);
    const r = await adapter.optionChain('NSE:NIFTY50-INDEX');
    expect(r).toMatchObject({ ok: false, code: 'UPSTREAM' });
    expect(urls.length).toBeLessThanOrEqual(4);
  });

  it('does not retry an expired login, and the token never appears in a message', async () => {
    const { adapter, urls } = adapterWith([json({ s: 'error', code: -16, message: 'token expired' })]);
    const r = await adapter.optionChain('NSE:NIFTY50-INDEX');
    expect(r).toMatchObject({ ok: false, code: 'LOGIN_REQUIRED' });
    expect(urls).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('SECRET-TOKEN-123');
  });
});
