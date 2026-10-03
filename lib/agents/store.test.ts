import { describe, expect, it } from 'vitest';

import { createD1Fake } from '../../tests/support/d1-fake';
import { createD1AgentStore, createMemoryAgentStore, type AgentStore } from './store';
import type { AnalystReport, Source, Verdict } from './schemas';

const MIGRATIONS = ['drizzle/0000_preflight.sql', 'drizzle/0001_strategy_lab_reports.sql', 'drizzle/0002_agent_team.sql'];
const NOW = new Date('2026-10-03T10:00:00.000Z');

const factories: [string, () => { store: AgentStore; db?: ReturnType<typeof createD1Fake> }][] = [
  ['memory', () => ({ store: createMemoryAgentStore(() => NOW) })],
  ['d1', () => { const db = createD1Fake(MIGRATIONS); return { store: createD1AgentStore(db, () => NOW), db }; }],
];

const source: Source = { id: 'regime-1', kind: 'regime', title: 'Regime', url: null, retrieved_at: NOW.toISOString() };
const verdict: Verdict = { verdict: 'REDUCE', reduce_to_lots: 2, reasons: [{ claim: 'c', type: 'fact', source_ids: ['regime-1'] }], missing_evidence: [], confidence_note: 'n' };
const report: AnalystReport = { role: 'technical', summary: 's', claims: [], missing_evidence: [] };
const cached = { report, sources: [source] };

describe.each(factories)('AgentStore (%s)', (_name, make) => {
  it('stores and reads back a whole run', async () => {
    const { store } = make();
    await store.createRun({ id: 'r1', symbol: 'NSE:TCS-EQ', asOf: '2026-10-01', tradingDate: '2026-10-01', candidate: { note: 'x' }, promptSet: 'agents-v1' });
    await store.saveStep({ runId: 'r1', role: 'technical', status: 'ok', output: report });
    await store.saveStep({ runId: 'r1', role: 'news', status: 'unavailable', error: 'feed down' });
    await store.saveSources('r1', [source]);
    await store.saveVerdict('r1', verdict);
    await store.setRunStatus('r1', 'completed', NOW.toISOString());

    const run = await store.getRun('r1');
    expect(run?.run).toMatchObject({ id: 'r1', symbol: 'NSE:TCS-EQ', status: 'completed', promptSet: 'agents-v1', completedAt: NOW.toISOString() });
    expect(run?.steps.map((step) => [step.role, step.status])).toEqual([['technical', 'ok'], ['news', 'unavailable']]);
    expect(run?.steps[0].output).toEqual(report);
    expect(run?.steps[1].error).toBe('feed down');
    expect(run?.sources).toEqual([source]);
    expect(run?.verdict).toEqual(verdict);
  });

  it('returns null for an unknown run and a null verdict before one is saved', async () => {
    const { store } = make();
    expect(await store.getRun('missing')).toBeNull();
    await store.createRun({ id: 'r2', symbol: 'NSE:TCS-EQ', asOf: '2026-10-01', tradingDate: '2026-10-01', candidate: {}, promptSet: 'agents-v1' });
    expect((await store.getRun('r2'))?.verdict).toBeNull();
    expect((await store.getRun('r2'))?.run.status).toBe('running');
  });

  it('caches analyst reports per symbol, trading day and role', async () => {
    const { store } = make();
    expect(await store.getCachedReport('NSE:TCS-EQ', '2026-10-01', 'technical')).toBeNull();
    await store.putCachedReport('NSE:TCS-EQ', '2026-10-01', 'technical', cached);
    expect(await store.getCachedReport('NSE:TCS-EQ', '2026-10-01', 'technical')).toEqual(cached);
    expect(await store.getCachedReport('NSE:TCS-EQ', '2026-10-02', 'technical')).toBeNull();
    expect(await store.getCachedReport('NSE:INFY-EQ', '2026-10-01', 'technical')).toBeNull();
    await store.putCachedReport('NSE:TCS-EQ', '2026-10-01', 'technical', { report: { ...report, summary: 'updated' }, sources: [] });
    expect((await store.getCachedReport('NSE:TCS-EQ', '2026-10-01', 'technical'))?.report.summary).toBe('updated');
  });
});

describe('D1 store call log', () => {
  it('writes an llm_calls row per logged call', async () => {
    const db = createD1Fake(MIGRATIONS);
    const store = createD1AgentStore(db, () => NOW);
    await store.logLlmCall({ runId: 'r1', role: 'technical', provider: 'alpha', model: 'm', promptHash: 'h', tokensIn: 10, tokensOut: 5, costInr: 0, latencyMs: 120, status: 'ok' });
    const row = await db.prepare('SELECT provider, tokens_in, cost_inr, status, created_at FROM llm_calls WHERE run_id = ?').bind('r1').first();
    expect(row).toEqual({ provider: 'alpha', tokens_in: 10, cost_inr: 0, status: 'ok', created_at: NOW.toISOString() });
  });

  it('does not create tables itself (migrations only)', () => {
    const db = createD1Fake(['drizzle/0000_preflight.sql']);
    const store = createD1AgentStore(db, () => NOW);
    return expect(store.createRun({ id: 'r', symbol: 's', asOf: 'a', tradingDate: 't', candidate: {}, promptSet: 'p' })).rejects.toThrow();
  });
});
