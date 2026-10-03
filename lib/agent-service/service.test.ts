import { describe, expect, it } from 'vitest';

import type { AnalystInput } from '../agents/orchestrator';
import { createD1AgentStore, createMemoryAgentStore } from '../agents/store';
import { createD1Fake } from '../../tests/support/d1-fake';
import type { LlmClient } from '../llm/types';
import { startAgentRun, type StartDeps } from './service';

const TOKEN = 'tok-SECRET-123';
const credentials = { clientId: 'CID', accessToken: TOKEN };
const NOW = new Date('2026-10-03T10:00:00Z'); // Saturday; last completed session is Fri 2026-10-02
const universe = new Set(['NSE:TCS-EQ', 'NSE:INFY-EQ']);

const technicalOnly: AnalystInput[] = [
  { role: 'technical', asOf: '2026-10-02', available: true, sources: [{ id: 'regime-1', kind: 'regime', title: 't', url: null, retrieved_at: NOW.toISOString() }], payload: {} },
  { role: 'options_oi', asOf: '2026-10-02', available: false, reason: 'x', sources: [], payload: {} },
  { role: 'news', asOf: '2026-10-02', available: false, reason: 'x', sources: [], payload: {} },
  { role: 'fundamentals', asOf: '2026-10-02', available: false, reason: 'x', sources: [], payload: {} },
];

const noProvider: LlmClient = { async complete() { return { ok: false, error: 'PROVIDER_ERROR', detail: 'no LLM provider configured' }; } };

function setup(extra: Partial<StartDeps> = {}) {
  const store = createMemoryAgentStore();
  const scheduled: Promise<unknown>[] = [];
  let counter = 0;
  const deps: StartDeps = {
    store,
    llm: noProvider,
    gather: async () => technicalOnly,
    schedule: (work) => { scheduled.push(work); },
    now: () => NOW,
    newId: () => `run-${(counter += 1)}`,
    universe,
    ...extra,
  };
  return { deps, store, settle: () => Promise.all(scheduled) };
}

describe('startAgentRun', () => {
  it('rejects a symbol outside the universe and creates no run', async () => {
    const { deps, store } = setup();
    expect(await startAgentRun(deps, { symbol: 'NSE:NOPE-EQ' }, credentials)).toMatchObject({ status: 400 });
    expect(await store.getRun('run-1')).toBeNull();
  });

  it.each([
    ['malformed asOf', { symbol: 'NSE:TCS-EQ', asOf: '2026-13-45' }],
    ['future asOf', { symbol: 'NSE:TCS-EQ', asOf: '2026-10-09' }],
    ['non-object body', 'hello'],
    ['zero lots', { symbol: 'NSE:TCS-EQ', calculatedLots: 0 }],
    ['fractional lots', { symbol: 'NSE:TCS-EQ', calculatedLots: 1.5 }],
    ['string lots', { symbol: 'NSE:TCS-EQ', calculatedLots: '3' }],
  ])('rejects %s', async (_label, body) => {
    const { deps } = setup();
    expect(await startAgentRun(deps, body, credentials)).toMatchObject({ status: 400 });
  });

  it('returns before the scheduled work finishes, with the run already visible as running', async () => {
    let release: (inputs: AnalystInput[]) => void = () => undefined;
    const gate = new Promise<AnalystInput[]>((resolve) => { release = resolve; });
    const { deps, store, settle } = setup({ gather: () => gate });
    const result = await startAgentRun(deps, { symbol: 'NSE:TCS-EQ' }, credentials);
    expect(result).toEqual({ runId: 'run-1' });
    expect((await store.getRun('run-1'))?.run.status).toBe('running');
    release(technicalOnly);
    await settle();
    expect((await store.getRun('run-1'))?.run.status).not.toBe('running');
  });

  it('defaults as-of to the last completed session', async () => {
    const { deps, store, settle } = setup();
    await startAgentRun(deps, { symbol: 'NSE:TCS-EQ' }, credentials);
    await settle();
    expect((await store.getRun('run-1'))?.run).toMatchObject({ asOf: '2026-10-02', tradingDate: '2026-10-02' });
  });

  it('ends ai_unavailable with the provider reason when no provider is configured', async () => {
    const { deps, store, settle } = setup();
    await startAgentRun(deps, { symbol: 'NSE:TCS-EQ' }, credentials);
    await settle();
    const run = await store.getRun('run-1');
    expect(run?.run.status).toBe('ai_unavailable');
    expect(run?.steps.find((step) => step.role === 'technical')?.error).toContain('no LLM provider configured');
  });

  it('marks the run failed with the error text when the scheduled work throws', async () => {
    const { deps, store, settle } = setup({ gather: async () => { throw new Error('gather exploded'); } });
    await startAgentRun(deps, { symbol: 'NSE:TCS-EQ' }, credentials);
    await settle();
    const run = await store.getRun('run-1');
    expect(run?.run.status).toBe('failed');
    expect(run?.steps.find((step) => step.status === 'failed')?.error).toContain('gather exploded');
  });

  it('never stores the access token even when an error echoes it', async () => {
    const { deps, store, settle } = setup({ gather: async () => { throw new Error(`failed with Bearer ${TOKEN}`); } });
    await startAgentRun(deps, { symbol: 'NSE:TCS-EQ' }, credentials);
    await settle();
    expect(JSON.stringify(await store.getRun('run-1'))).not.toContain(TOKEN);
  });

  it('passes calculatedLots through so the verdict can be clamped', async () => {
    const verdict = JSON.stringify({ verdict: 'APPROVE', reasons: [{ claim: 'c', type: 'fact', source_ids: ['regime-1'] }], missing_evidence: [], confidence_note: 'n' });
    const analyst = JSON.stringify({ role: 'technical', summary: 's', claims: [{ claim: 'c', type: 'fact', source_ids: ['regime-1'] }], missing_evidence: [] });
    const llm: LlmClient = { async complete(request) { return { ok: true, text: request.role === 'technical' ? analyst : request.role === 'risk_pm' ? verdict : 'text', provider: 'fake', model: 'fake', tokensIn: 1, tokensOut: 1 }; } };
    const { deps, store, settle } = setup({ llm });
    await startAgentRun(deps, { symbol: 'NSE:TCS-EQ', calculatedLots: 3 }, credentials);
    await settle();
    const run = await store.getRun('run-1');
    expect(run?.run.status).toBe('completed');
    expect(run?.run.candidate).toEqual({ calculatedLots: 3 });
  });

  it('works against the D1 store: the run row is created once and the run reaches a terminal state', async () => {
    const db = createD1Fake(['drizzle/0000_preflight.sql', 'drizzle/0001_strategy_lab_reports.sql', 'drizzle/0002_agent_team.sql']);
    const store = createD1AgentStore(db, () => NOW);
    const { deps, settle } = setup({ store });
    await startAgentRun(deps, { symbol: 'NSE:TCS-EQ' }, credentials);
    await settle();
    const run = await store.getRun('run-1');
    expect(run?.run.status).toBe('ai_unavailable');
    expect(run?.steps.some((step) => step.role === 'run' && step.status === 'failed')).toBe(false);
  });
});
