import { describe, expect, it } from 'vitest';

import { chunkRanges, epochToIstDate, fetchDailyCandles } from './fyers-daily';

const credentials = { clientId: 'client', accessToken: 'token' };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('chunkRanges', () => {
  it('splits a long range into consecutive chunks without overlap or gaps', () => {
    const chunks = chunkRanges('2024-01-01', '2026-01-01', 360);
    expect(chunks[0].from).toBe('2024-01-01');
    expect(chunks.at(-1)!.to).toBe('2026-01-01');
    for (let i = 1; i < chunks.length; i += 1) {
      const previousEnd = new Date(`${chunks[i - 1].to}T00:00:00Z`).getTime();
      expect(new Date(`${chunks[i].from}T00:00:00Z`).getTime() - previousEnd).toBe(86_400_000);
    }
  });

  it('never makes a chunk that spans more calendar days (both ends included) than the limit', () => {
    for (const chunk of chunkRanges('2023-03-01', '2026-09-29', 360)) {
      const inclusiveDays = (new Date(`${chunk.to}T00:00:00Z`).getTime() - new Date(`${chunk.from}T00:00:00Z`).getTime()) / 86_400_000 + 1;
      expect(inclusiveDays).toBeLessThanOrEqual(360);
    }
  });

  it('returns a single chunk for a short range and none for an inverted range', () => {
    expect(chunkRanges('2026-01-01', '2026-02-01', 360)).toEqual([{ from: '2026-01-01', to: '2026-02-01' }]);
    expect(chunkRanges('2026-02-01', '2026-01-01', 360)).toEqual([]);
  });
});

describe('epochToIstDate', () => {
  it('maps IST midnight and the previous UTC evening to the same India date', () => {
    expect(epochToIstDate(Date.parse('2026-09-28T18:30:00Z') / 1000)).toBe('2026-09-29');
    expect(epochToIstDate(Date.parse('2026-09-29T03:45:00Z') / 1000)).toBe('2026-09-29');
  });
});

describe('fetchDailyCandles', () => {
  it('merges chunks, converts epochs to IST dates and dedupes overlap', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: URL | string) => {
      calls.push(String(url));
      return jsonResponse({ s: 'ok', candles: [[Date.parse('2026-09-28T18:30:00Z') / 1000, 1, 2, 0.5, 101.5, 10]] });
    }) as unknown as typeof fetch;
    const result = await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2024-01-01', '2026-01-01', fetchImpl);
    expect(result).toEqual({ ok: true, candles: [{ date: '2026-09-29', close: 101.5 }] });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0]).toContain('resolution=');
  });

  it('returns candles sorted ascending across unordered chunks', async () => {
    const epochs = [Date.parse('2026-01-06T18:30:00Z') / 1000, Date.parse('2026-01-04T18:30:00Z') / 1000];
    const fetchImpl = (async () => jsonResponse({ s: 'ok', candles: epochs.map((e, i) => [e, 1, 1, 1, 10 + i, 1]) })) as unknown as typeof fetch;
    const result = await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-01-31', fetchImpl);
    expect(result.ok && result.candles.map((c) => c.date)).toEqual(['2026-01-05', '2026-01-07']);
  });

  it('sends the token only in the Authorization header, never in the URL', async () => {
    let seenUrl = '';
    let seenHeaders: HeadersInit | undefined;
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      seenUrl = String(url);
      seenHeaders = init?.headers;
      return jsonResponse({ s: 'ok', candles: [] });
    }) as unknown as typeof fetch;
    await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-01-31', fetchImpl);
    expect(seenUrl).not.toContain('token');
    expect((seenHeaders as Record<string, string>).Authorization).toBe('client:token');
  });

  it('maps a FYERS auth error (code -16) to 401', async () => {
    const fetchImpl = (async () => jsonResponse({ s: 'error', code: -16, message: 'Could not authenticate the user' }, 401)) as unknown as typeof fetch;
    expect(await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-02-01', fetchImpl)).toMatchObject({ ok: false, status: 401 });
  });

  it('maps an expired-token code (-22) to 401', async () => {
    const fetchImpl = (async () => jsonResponse({ s: 'error', code: -22, message: 'Could not authenticate the user' }, 200)) as unknown as typeof fetch;
    expect(await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-02-01', fetchImpl)).toMatchObject({ ok: false, status: 401 });
  });

  it('maps an unknown code to 401 when the message says the user could not be authenticated', async () => {
    const fetchImpl = (async () => jsonResponse({ s: 'error', code: -999, message: 'Could not authenticate the user' }, 200)) as unknown as typeof fetch;
    expect(await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-02-01', fetchImpl)).toMatchObject({ ok: false, status: 401 });
  });

  it('does not treat an unrelated FYERS error as a token problem', async () => {
    const fetchImpl = (async () => jsonResponse({ s: 'error', code: -300, message: 'Invalid symbol' }, 200)) as unknown as typeof fetch;
    expect(await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-02-01', fetchImpl)).toMatchObject({ ok: false, status: 502 });
  });

  it('maps other failures to 502 and never returns partial candles', async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      return call === 1 ? jsonResponse({ s: 'ok', candles: [[Date.parse('2026-01-04T18:30:00Z') / 1000, 1, 1, 1, 10, 1]] }) : jsonResponse({ s: 'error', message: 'boom' }, 500);
    }) as unknown as typeof fetch;
    const result = await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2024-01-01', '2026-01-01', fetchImpl);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect('candles' in result).toBe(false);
  });

  it('turns a network failure into a 502 with a readable message instead of throwing', async () => {
    const fetchImpl = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const result = await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-02-01', fetchImpl);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(result.ok === false && result.message).toMatch(/could not reach fyers/i);
  });

  it('turns a network failure in a later chunk into a 502 with no partial candles', async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 2) throw new Error('socket hang up');
      return jsonResponse({ s: 'ok', candles: [[Date.parse('2026-01-04T18:30:00Z') / 1000, 1, 1, 1, 10, 1]] });
    }) as unknown as typeof fetch;
    const result = await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2024-01-01', '2026-01-01', fetchImpl);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect('candles' in result).toBe(false);
  });

  it('does not put the token in the error message', async () => {
    const fetchImpl = (async () => { throw new Error('connect ECONNREFUSED client:token'); }) as unknown as typeof fetch;
    const result = await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-02-01', fetchImpl);
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it('treats a non-JSON response as a 502, not a crash', async () => {
    const fetchImpl = (async () => new Response('<html>gateway</html>', { status: 502 })) as unknown as typeof fetch;
    expect(await fetchDailyCandles(credentials, 'NSE:TCS-EQ', '2026-01-01', '2026-02-01', fetchImpl)).toMatchObject({ ok: false, status: 502 });
  });
});
