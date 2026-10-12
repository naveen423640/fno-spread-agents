import { describe, expect, it } from 'vitest';

import { sendTokenToCloud } from '@/lib/ltp/cloud-token';

const TOKEN = 'secret-fyers-token-xyz';
const SECRET = 'admin-secret-123';
const URL_BASE = 'https://ltp-recorder.example.workers.dev';

const recorder = (status = 200) => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify({ ok: status === 200 }), { status }); }) as unknown as typeof fetch;
  return { seen, fetchImpl };
};

describe('sendTokenToCloud: the logged-in FYERS token goes from the app to the cloud recorder', () => {
  it('PUTs the token to /token with the admin secret as a Bearer header', async () => {
    const { seen, fetchImpl } = recorder();
    expect(await sendTokenToCloud({ accessToken: TOKEN, url: `${URL_BASE}/`, secret: SECRET, fetchImpl })).toEqual({ ok: true });
    expect(seen[0].url).toBe(`${URL_BASE}/token`);
    expect(seen[0].init?.method).toBe('PUT');
    expect((seen[0].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(seen[0].init?.body as string)).toEqual({ token: TOKEN });
  });
  it('without a FYERS login it asks you to connect first and calls nothing', async () => {
    const { seen, fetchImpl } = recorder();
    expect(await sendTokenToCloud({ accessToken: undefined, url: URL_BASE, secret: SECRET, fetchImpl })).toMatchObject({ ok: false, status: 401, error: expect.stringMatching(/connect fyers/i) });
    expect(seen).toHaveLength(0);
  });
  it('without the recorder address or secret configured it says what to set', async () => {
    const { seen, fetchImpl } = recorder();
    for (const over of [{ url: undefined }, { secret: undefined }, { url: '' }]) {
      expect(await sendTokenToCloud({ accessToken: TOKEN, url: URL_BASE, secret: SECRET, fetchImpl, ...over })).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/LTP_RECORDER_URL.*LTP_RECORDER_SECRET/) });
    }
    expect(seen).toHaveLength(0);
  });
  it('a refusal from the recorder is reported, and a wrong secret says so', async () => {
    expect(await sendTokenToCloud({ accessToken: TOKEN, url: URL_BASE, secret: SECRET, fetchImpl: recorder(401).fetchImpl })).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/401.*secret/i) });
    expect(await sendTokenToCloud({ accessToken: TOKEN, url: URL_BASE, secret: SECRET, fetchImpl: recorder(500).fetchImpl })).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/500/) });
  });
  it('an unreachable recorder is reported without leaking the token or the secret', async () => {
    const fetchImpl = (async () => { throw new Error(`connect failed for Bearer ${SECRET} token ${TOKEN}`); }) as unknown as typeof fetch;
    const result = await sendTokenToCloud({ accessToken: TOKEN, url: URL_BASE, secret: SECRET, fetchImpl });
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
