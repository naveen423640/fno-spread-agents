import type { AnalystInput } from '../agents/orchestrator';
import { lastCompletedSession } from '../market-session';
import { safeReason, unavailable, type GatherArgs, type GatherDeps } from './common';

type Strike = { strike: number; call: { oi: number; oiChange: number } | null; put: { oi: number; oiChange: number } | null };

function top(strikes: Strike[], side: 'call' | 'put') {
  return strikes
    .filter((row) => row[side])
    .sort((a, b) => (b[side]?.oi ?? 0) - (a[side]?.oi ?? 0))
    .slice(0, 5)
    .map((row) => ({ strike: row.strike, oi: row[side]?.oi ?? 0, oiChange: row[side]?.oiChange ?? 0 }));
}

export async function gatherOptionsOi(args: GatherArgs, deps: GatherDeps): Promise<AnalystInput> {
  const { symbol, asOf, now, credentials } = args;
  if (!credentials) return unavailable('options_oi', asOf, 'FYERS is not connected, so the option chain is unavailable');
  if (asOf < lastCompletedSession(now)) return unavailable('options_oi', asOf, 'The option chain is live only; it cannot be shown as of a past date');
  try {
    const [quote, chain] = await Promise.all([deps.loadQuote(credentials, symbol), deps.loadOptionChain(credentials, symbol)]);
    const retrieved = now.toISOString();
    return {
      role: 'options_oi',
      asOf,
      available: true,
      cacheable: false,
      sources: [
        { id: 'chain-1', kind: 'option_chain', title: `Nearest-expiry option chain (${chain.expiry})`, url: null, retrieved_at: retrieved },
        { id: 'quote-1', kind: 'price_oi', title: 'Latest equity quote', url: null, retrieved_at: retrieved },
      ],
      payload: {
        liveDataAt: retrieved,
        quote,
        expiry: chain.expiry,
        spot: chain.spot,
        atmStrike: chain.atmStrike,
        totalCallOi: chain.totalCallOi,
        totalPutOi: chain.totalPutOi,
        pcr: chain.pcr,
        topCallOi: top(chain.strikes, 'call'),
        topPutOi: top(chain.strikes, 'put'),
        banStatus: 'unknown',
        notes: ['Ban-list status is not wired to the engine yet.', 'IV is the vendor value per strike; no IV history is available.'],
      },
    };
  } catch (error) {
    return unavailable('options_oi', asOf, safeReason(error, credentials));
  }
}
