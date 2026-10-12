import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/fyers/callback/route';

const call = (query: string, cookie?: string) => GET(new Request(`https://app.example/api/fyers/callback?${query}`, { headers: cookie ? { cookie } : {} }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('the FYERS login callback says which part of the login went wrong', () => {
  it('FYERS sent no login code', async () => {
    const res = await call('state=abc', 'fyers_oauth_state=abc');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/did not send back a login code/i);
  });
  it('the browser has no login cookie: finished somewhere other than where Connect FYERS was pressed', async () => {
    const res = await call('auth_code=x&state=abc');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/cookie.*same browser/i);
  });
  it('the cookie is from another attempt', async () => {
    const res = await call('auth_code=x&state=abc', 'fyers_oauth_state=other');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/earlier attempt/i);
  });
  it('a matching cookie and code go on to the token exchange, and the token is stored in a cookie, never in the answer', async () => {
    vi.stubEnv('FYERS_CLIENT_ID', 'APP-100');
    vi.stubEnv('FYERS_SECRET_KEY', 'shh');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ s: 'ok', access_token: 'the-token' }));
    const res = await call('auth_code=x&state=abc', 'fyers_oauth_state=abc');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example/');
    expect(res.headers.getSetCookie().some((c) => c.startsWith('fyers_access_token=the-token'))).toBe(true);
  });
});
