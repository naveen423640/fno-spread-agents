import { getDatabaseBinding } from '@/db';

import { gatherInputs } from '../agent-inputs';
import { createD1AgentStore } from '../agents/store';
import { createLlmClient } from '../llm/client';
import { parseProviders } from '../llm/config';
import { createLimiter } from '../llm/limits';
import { marketSnapshot } from '../market-snapshot';
import type { StartDeps } from './service';

// One limiter per isolate: rate and quota counters are in-memory and are NOT shared across Worker instances (unverified for cloud use).
const limiter = createLimiter(() => Date.now());
const universe = new Set(marketSnapshot.map((stock) => stock.symbol));

export async function scheduler(): Promise<StartDeps['schedule']> {
  try {
    const workers = (await import('cloudflare:workers')) as { waitUntil?: (work: Promise<unknown>) => void };
    if (typeof workers.waitUntil === 'function') return (work) => workers.waitUntil?.(work);
  } catch {
    // Not running inside a Worker runtime.
  }
  return (work) => { void work; };
}

// Provider keys come from LLM_PROVIDERS and the env vars it names. With none configured, runs end AI_UNAVAILABLE.
export async function buildStartDeps(): Promise<StartDeps> {
  const store = createD1AgentStore(getDatabaseBinding());
  const providers = parseProviders(process.env);
  return {
    store,
    llm: createLlmClient({ providers, limiter, log: store.logLlmCall }),
    gather: gatherInputs,
    schedule: await scheduler(),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    universe,
    maxRunsPerDay: Number(process.env.AGENT_RUNS_PER_DAY) || 50,
  };
}

export function buildReadStore() {
  return createD1AgentStore(getDatabaseBinding());
}
