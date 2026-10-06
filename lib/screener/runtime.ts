import { getDatabaseBinding } from '@/db';

import { scheduler } from '../agent-service/runtime';
import { fyersCredentials } from '../backtest/fyers-data';
import { createFyersAdapter } from './broker/fyers';
import { createKiteAdapter } from './broker/kite';
import { UNIVERSE } from './config';
import { HOLIDAYS } from './holidays';
import type { ScreenerDeps } from './service';
import { createScreenerStore } from './store';

// Server-side wiring for the Screener routes. The broker connection is the app's existing one: the FYERS cookie or env token
// through fyersCredentials(), or the Kite env keys. No second login flow exists here, and no token is stored or returned.

export function liveBrokerName(): 'fyers' | 'kite' {
  return process.env.SCREENER_BROKER === 'kite' ? 'kite' : 'fyers';
}

const kiteCredentials = () => {
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  return apiKey && accessToken ? { apiKey, accessToken } : null;
};

export function liveConnected(request: Request): boolean {
  return liveBrokerName() === 'kite' ? kiteCredentials() !== null : fyersCredentials(request) !== null;
}

export async function buildScreenerDeps(request: Request): Promise<ScreenerDeps> {
  const liveBroker = liveBrokerName();
  const fyers = liveBroker === 'fyers' ? fyersCredentials(request) : null;
  const kite = liveBroker === 'kite' ? kiteCredentials() : null;
  return {
    store: createScreenerStore(getDatabaseBinding()),
    brokerFor: (source) => (source === 'fyers' && fyers ? createFyersAdapter({ credentials: fyers }) : source === 'kite' && kite ? createKiteAdapter({ credentials: kite }) : null),
    now: () => new Date(),
    schedule: await scheduler(),
    newId: () => crypto.randomUUID(),
    holidays: HOLIDAYS,
    universe: UNIVERSE,
    maxJobsPerDay: Number(process.env.SCREENER_JOBS_PER_DAY) || 20,
    synthetic: { stocks: Object.keys(UNIVERSE).length, days: 1500, seed: 7 },
  };
}
