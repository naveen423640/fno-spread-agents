import { getDatabaseBinding } from '@/db';

import { fyersCredentials } from '../backtest/fyers-data';
import { createBoardCacheProvider } from './cache-provider';
import { createFyersProvider, type DataProvider } from './provider';
import { createVwapStore } from './store';

export type VwapSource = 'fyers' | 'cache';
export const parseSource = (value: unknown): VwapSource => (value === 'cache' ? 'cache' : 'fyers');

// Server-side wiring for the VWAP routes. The FYERS login is the app's existing one (cookie, or FYERS_ACCESS_TOKEN); no token is stored or returned.
export function vwapDeps(request: Request, source: VwapSource): { ok: true; provider: DataProvider; store: ReturnType<typeof createVwapStore> } | { ok: false; loginRequired: true } {
  const db = getDatabaseBinding();
  const store = createVwapStore(db);
  if (source === 'cache') return { ok: true, provider: createBoardCacheProvider(db), store };
  const credentials = fyersCredentials(request);
  return credentials ? { ok: true, provider: createFyersProvider({ credentials }), store } : { ok: false, loginRequired: true };
}
