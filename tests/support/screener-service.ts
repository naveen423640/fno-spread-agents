import { createMockAdapter } from '../../lib/screener/broker/mock';
import type { BrokerAdapter } from '../../lib/screener/broker/types';
import { UNIVERSE } from '../../lib/screener/config';
import { createScreenerStore } from '../../lib/screener/store';
import { makeSynthetic } from '../../lib/screener/synthetic';
import type { ScreenerDeps } from '../../lib/screener/service';
import { createD1Fake } from './d1-fake';

export const MIGRATIONS = ['drizzle/0000_preflight.sql', 'drizzle/0001_strategy_lab_reports.sql', 'drizzle/0002_agent_team.sql', 'drizzle/0003_screener.sql'];
// Tuesday 2026-10-06, 16:30 IST: the session for that day is complete.
export const AFTER_CLOSE = new Date('2026-10-06T11:00:00Z');
// Tuesday 2026-10-06, 11:00 IST: the session is still open.
export const DURING_SESSION = new Date('2026-10-06T05:30:00Z');
export const SMALL_UNIVERSE = Object.fromEntries(Object.entries(UNIVERSE).slice(0, 4));

export type Spy = BrokerAdapter & { calls: { method: string; args: unknown[] }[] };

// Wraps an adapter and records every call, so tests can assert what was (not) requested.
export function spy(base: BrokerAdapter, overrides: Partial<BrokerAdapter> = {}): Spy {
  const calls: Spy['calls'] = [];
  const wrap = <K extends keyof BrokerAdapter>(method: K): BrokerAdapter[K] =>
    (((...args: unknown[]) => {
      calls.push({ method, args });
      const impl = (overrides[method] ?? base[method]) as (...a: unknown[]) => unknown;
      return impl.apply(overrides[method] ? overrides : base, args);
    }) as unknown) as BrokerAdapter[K];
  return {
    name: base.name,
    equitySymbol: (ticker) => base.equitySymbol(ticker),
    indexSymbol: () => base.indexSymbol(),
    optionSymbol: (underlying, expiryIso, strike, kind) => base.optionSymbol(underlying, expiryIso, strike, kind),
    history: wrap('history'),
    quote: wrap('quote'),
    lotSize: wrap('lotSize'),
    optionOi: wrap('optionOi'),
    calls,
  };
}

export function mockBroker(endDate: string, stocks = 4, days = 400, seed = 3) {
  const { data, bench } = makeSynthetic({ stocks, days, seed, endDate });
  return { data, bench, adapter: createMockAdapter({ data, bench, defaultLot: 100 }) };
}

export function makeDeps(over: Partial<ScreenerDeps> = {}) {
  const db = createD1Fake(MIGRATIONS);
  const scheduled: Promise<unknown>[] = [];
  let n = 0;
  const now = over.now ?? (() => AFTER_CLOSE);
  const store = createScreenerStore(db, now);
  const deps: ScreenerDeps = {
    store,
    brokerFor: () => null,
    now,
    schedule: (work) => { scheduled.push(work); },
    newId: () => `job-${(n += 1)}`,
    holidays: new Set(),
    universe: SMALL_UNIVERSE,
    maxJobsPerDay: 50,
    synthetic: { stocks: 4, days: 500, seed: 3 },
    ...over,
  };
  return { deps, store, db, settle: () => Promise.all(scheduled) };
}
