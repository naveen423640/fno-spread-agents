import { describe, expect, it } from 'vitest';

import { probeOptionData } from '@/lib/vwap/option-probe';

const creds = { clientId: 'c', accessToken: 'SECRET-TOKEN' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const T = (day: string, i: number) => Date.parse(`${day}T09:15:00+05:30`) / 1000 + i * 300;

const chain = (withSymbol: boolean) => ({
  s: 'ok',
  data: {
    expiryData: [{ date: '27-10-2026' }],
    optionsChain: [
      { symbol: 'NSE:NIFTY50-INDEX', ltp: 24520 },
      ...[24400, 24500, 24600].flatMap((strike) => ['CE', 'PE'].map((option_type) => ({ ...(withSymbol ? { symbol: `NSE:NIFTY26OCT${strike}${option_type}` } : {}), option_type, strike_price: strike, ltp: 100, oi: 5000, oich: 100, prev_oi: 4900 }))),
    ],
  },
});

function fakeFyers(opts: { symbols?: boolean; candles?: number[][] | 'none'; expired?: boolean }) {
  const urls: string[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input));
    urls.push(url.pathname + url.search);
    if (opts.expired) return json({ s: 'error', code: -16, message: 'token expired' });
    if (url.pathname.endsWith('options-chain-v3')) return json(chain(opts.symbols ?? true));
    if (url.pathname.endsWith('history')) return opts.candles === 'none' ? json({ s: 'no_data' }) : json({ s: 'ok', candles: opts.candles ?? [] });
    return json({ s: 'error' }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

describe('probeOptionData', () => {
  const rows = (cols: number) => [[T('2026-10-08', 0), 100, 101, 99, 100, 500, 5000].slice(0, cols), [T('2026-10-09', 0), 100, 102, 99, 101, 0, 5100].slice(0, cols)];

  it('reads the chain, picks the at-the-money strike and reports candles and open interest for the call and the put', async () => {
    const { fetchImpl, urls } = fakeFyers({ candles: rows(7) });
    const r = await probeOptionData({ credentials: creds, today: '2026-10-12', fetchImpl });
    expect(r.chain).toMatchObject({ ok: true, legs: 6, spot: 24520, hasSymbolField: true, expiries: ['27-10-2026'] });
    expect(r.atmStrike).toBe(24500);
    expect(r.contracts.map((c) => c.symbol)).toEqual(['NSE:NIFTY26OCT24500CE', 'NSE:NIFTY26OCT24500PE']);
    expect(r.contracts[0].intraday).toMatchObject({ ok: true, candles: 2, sessions: 2, firstDay: '2026-10-08', lastDay: '2026-10-09', hasOiColumn: true, candlesWithVolume: 1 });
    expect(r.contracts[0].daily.hasOiColumn).toBe(true);
    expect(r.verdict.join(' ')).toMatch(/5-minute option candles are available/);
    expect(r.verdict.join(' ')).toMatch(/include an open-interest column/);
    expect(urls.filter((u) => u.includes('oi_flag=1')).length).toBe(4); // two contracts, intraday and daily
  });

  it('returns the first six legs of the real response untouched, so a real fixture can be saved from it', async () => {
    const { fetchImpl } = fakeFyers({ candles: rows(7) });
    const r = await probeOptionData({ credentials: creds, today: '2026-10-12', fetchImpl });
    expect(r.chain.rawSample).toEqual(chain(true).data.optionsChain.slice(0, 6));
  });

  it('can probe another index and builds BSE contract symbols with the BSE prefix', async () => {
    const { fetchImpl, urls } = fakeFyers({ symbols: false, candles: rows(7) });
    const r = await probeOptionData({ credentials: creds, today: '2026-10-12', fetchImpl, underlying: 'SENSEX', indexSymbol: 'BSE:SENSEX-INDEX' });
    expect(urls[0]).toContain('symbol=BSE%3ASENSEX-INDEX');
    expect(r.contracts[0].symbol.startsWith('BSE:SENSEX26OCT')).toBe(true);
  });

  it('builds the monthly contract symbol when the chain gives none', async () => {
    const { fetchImpl } = fakeFyers({ symbols: false, candles: rows(6) });
    const r = await probeOptionData({ credentials: creds, today: '2026-10-12', fetchImpl });
    expect(r.chain.hasSymbolField).toBe(false);
    expect(r.contracts[0].symbol).toBe('NSE:NIFTY26OCT24500CE');
    expect(r.contracts[0].intraday.hasOiColumn).toBe(false);
    expect(r.verdict.join(' ')).toMatch(/no symbol field/);
    expect(r.verdict.join(' ')).toMatch(/no open-interest column/);
  });

  it('says so plainly when FYERS has no candles for the contracts', async () => {
    const { fetchImpl } = fakeFyers({ candles: 'none' });
    const r = await probeOptionData({ credentials: creds, today: '2026-10-12', fetchImpl });
    expect(r.contracts[0].intraday.ok).toBe(false);
    expect(r.verdict.join(' ')).toMatch(/returned no 5-minute candles/);
  });

  it('stops on an expired login and never echoes the token', async () => {
    const { fetchImpl } = fakeFyers({ expired: true });
    const r = await probeOptionData({ credentials: creds, today: '2026-10-12', fetchImpl });
    expect(r.loginRequired).toBe(true);
    expect(JSON.stringify(r)).not.toContain('SECRET-TOKEN');
  });

  it('reports a failed chain call without trying the contracts', async () => {
    const fetchImpl = (async () => json({ s: 'error', message: 'no chain' })) as unknown as typeof fetch;
    const r = await probeOptionData({ credentials: creds, today: '2026-10-12', fetchImpl });
    expect(r.chain).toMatchObject({ ok: false, error: 'no chain' });
    expect(r.contracts).toEqual([]);
  });
});
