import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { experimentFileName, nextExperimentId, parseProposals, proposeExperiments, serializeExperiment } from '@/lib/ltp-agent/experiments';
import { writeExperimentFile } from '@/lib/ltp-agent/experiment-files';
import { PhaseLockedError } from '@/lib/ltp-agent/phase';
import { parseStrategy } from '@/lib/ltp-agent/strategy';
import { readFileSync as read } from 'node:fs';
import type { LlmClient, LlmRequest, LlmResult } from '@/lib/llm/types';
import { freshStores } from '../support/ltp-agent-day';
import { closedTrade, makeDecision, seedClosedTrades } from '../support/ltp-agent-journal';

const v01 = parseStrategy(read('strategies/ltp_v0.1.yaml', 'utf8'));
const split = { discovery: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'], holdout: ['2026-10-05'] };
const proposal = (diff: Record<string, unknown>, hypothesis = 'Wider touch tolerance catches more clean entries') => ({ hypothesis, diff, expected_effect: 'more trades with similar expectancy', evidence: ['stop_too_tight x12'] });
const ok = (text: string): LlmResult => ({ ok: true, text, provider: 'anthropic', model: 'test-model', tokensIn: 1, tokensOut: 1 });
function fakeLlm(script: (string | LlmResult)[]) {
  const calls: LlmRequest[] = [];
  const llm: LlmClient = { async complete(r) { calls.push(r); const next = script[Math.min(calls.length - 1, script.length - 1)]; return typeof next === 'string' ? ok(next) : next; } };
  return { llm, calls };
}
const reply = (...proposals: unknown[]) => JSON.stringify({ experiments: proposals });
async function learning() {
  const stores = freshStores();
  await seedClosedTrades(stores.journal, { n: 100, days: [...split.discovery] });
  return stores.journal;
}

describe('proposals are locked until 100 closed trades', () => {
  it('99 closed trades: refused with the phase error, and the model is never called', async () => {
    const { journal } = freshStores();
    await seedClosedTrades(journal, { n: 99, days: [...split.discovery] });
    const { llm, calls } = fakeLlm([reply(proposal({ touch_tolerance_pts: 8 }))]);
    await expect(proposeExperiments({ llm, journal }, v01, split)).rejects.toThrow(PhaseLockedError);
    expect(calls).toHaveLength(0);
  });
  it('exactly 100: proposals are accepted', async () => {
    const journal = await learning();
    const r = await proposeExperiments({ llm: fakeLlm([reply(proposal({ touch_tolerance_pts: 8 }))]).llm, journal }, v01, split);
    expect(r.experiments).toHaveLength(1);
  });
});

describe('what a proposal must look like to be kept', () => {
  it('valid proposals are saved as EXP-001, EXP-002 with the base version, the split and a running count of everything tried', async () => {
    const journal = await learning();
    const r = await proposeExperiments({ llm: fakeLlm([reply(proposal({ touch_tolerance_pts: 8 }), proposal({ max_hit_number: 1 }, 'Only first touches'))]).llm, journal }, v01, split);
    expect(r.experiments.map((e) => [e.id, e.status, e.triedCount, e.baseVersion])).toEqual([['EXP-001', 'proposed', 1, '0.1'], ['EXP-002', 'proposed', 2, '0.1']]);
    expect(r.experiments[0]).toMatchObject({ diff: { touch_tolerance_pts: 8 }, split, evidence: ['stop_too_tight x12'] });
    expect((await journal.listExperiments()).map((e) => e.id)).toEqual(['EXP-001', 'EXP-002']);
  });
  it('a field that is not tunable and an out-of-bounds value are dropped, each with its reason, and the valid one is kept', async () => {
    const journal = await learning();
    const r = await proposeExperiments({ llm: fakeLlm([reply(proposal({ stop_buffer_pts: 20 }), proposal({ 'risk.daily_loss_cap_inr': 1 }), proposal({ max_hit_number: 9 }))]).llm, journal }, v01, split);
    expect(r.experiments.map((e) => e.diff)).toEqual([{ stop_buffer_pts: 20 }]);
    expect(r.dropped.map((d) => d.reason)).toEqual([expect.stringMatching(/not a tunable/), expect.stringMatching(/between 1 and 5/)]);
  });
  it('a change that changes nothing is dropped (touch_tolerance_pts is already 5)', async () => {
    const journal = await learning();
    const r = await proposeExperiments({ llm: fakeLlm([reply(proposal({ touch_tolerance_pts: 5 }), proposal({ touch_tolerance_pts: 8 }))]).llm, journal }, v01, split);
    expect(r.experiments.map((e) => e.diff)).toEqual([{ touch_tolerance_pts: 8 }]);
    expect(r.dropped.map((d) => d.reason)).toEqual([expect.stringMatching(/no change/i)]);
  });
  it('at most 3 are kept: the rest are dropped', async () => {
    const journal = await learning();
    const four = [8, 9, 10, 11].map((v) => proposal({ touch_tolerance_pts: v }, `tolerance ${v}`));
    const r = await proposeExperiments({ llm: fakeLlm([reply(...four)]).llm, journal }, v01, split);
    expect(r.experiments).toHaveLength(3);
    expect(r.dropped.map((d) => d.reason)).toEqual([expect.stringMatching(/more than 3/i)]);
  });
  it('ids keep increasing across runs and the tried count includes every experiment ever, whatever its status', async () => {
    const journal = await learning();
    await proposeExperiments({ llm: fakeLlm([reply(proposal({ touch_tolerance_pts: 8 }))]).llm, journal }, v01, split);
    const first = (await journal.listExperiments())[0];
    await journal.saveExperiment({ ...first, status: 'rejected_by_gate' });
    const r = await proposeExperiments({ llm: fakeLlm([reply(proposal({ stop_buffer_pts: 20 }))]).llm, journal }, v01, split);
    expect(r.experiments[0]).toMatchObject({ id: 'EXP-002', triedCount: 2 });
    expect(nextExperimentId([{ id: 'EXP-009' }, { id: 'EXP-003' }])).toBe('EXP-010');
    expect(nextExperimentId([])).toBe('EXP-001');
  });
});

describe('failures', () => {
  it('invalid JSON is retried once and then reported; nothing is saved', async () => {
    const journal = await learning();
    const { llm, calls } = fakeLlm(['nope']);
    const r = await proposeExperiments({ llm, journal }, v01, split);
    expect(r.experiments).toEqual([]);
    expect(r.failure).toMatch(/invalid/i);
    expect(calls).toHaveLength(2);
    expect(await journal.listExperiments()).toEqual([]);
  });
  it('a model that proposes nothing is a valid answer', async () => {
    const journal = await learning();
    const r = await proposeExperiments({ llm: fakeLlm([reply()]).llm, journal }, v01, split);
    expect(r).toMatchObject({ experiments: [], dropped: [] });
  });
  it('a provider failure is reported, not thrown', async () => {
    const journal = await learning();
    const r = await proposeExperiments({ llm: fakeLlm([{ ok: false, error: 'PROVIDER_ERROR', detail: 'HTTP 500' }]).llm, journal }, v01, split);
    expect(r.failure).toMatch(/PROVIDER_ERROR/);
  });
  it('parseProposals accepts a fenced reply', () => {
    expect(parseProposals('```json\n' + reply(proposal({ touch_tolerance_pts: 8 })) + '\n```')).toHaveLength(1);
  });
});

describe('what the proposer is shown: discovery only', () => {
  it('no holdout trade, review or result reaches the prompt, and earlier experiments appear without their metrics', async () => {
    const stores = freshStores();
    const { journal } = stores;
    await seedClosedTrades(journal, { n: 100, days: [...split.discovery], review: (i) => ({ outcome_class: 'good_trade_bad_result', mistake_tags: ['stop_too_tight'], what_happened: `discovery note ${i}`, lesson: 'tighten nothing', confidence: 0.7 }) });
    const leak = makeDecision({ decisionId: 'holdout-trade', tradeDate: '2026-10-05', ts: Date.parse('2026-10-05T05:00:00Z') / 1000 });
    await journal.recordDecision(leak);
    await journal.recordTrade({ decisionId: leak.decisionId, book: 'buy', status: 'open', openedTs: leak.ts, position: {} });
    await journal.recordOutcome(leak.decisionId, 'buy', closedTrade(123456, '2026-10-05'));
    await journal.recordReview(leak.decisionId, { lesson: 'HOLDOUT_REVIEW_TEXT', mistake_tags: [] }, 'm');
    await journal.saveExperiment({ id: 'EXP-001', hypothesis: 'earlier idea', diff: { stop_buffer_pts: 5 }, expectedEffect: 'x', evidence: [], baseVersion: '0.1', split, status: 'rejected_by_gate', results: { secret: 'HOLDOUT_METRIC_999' } as never, triedCount: 1, createdTs: 1 });
    const { llm, calls } = fakeLlm([reply()]);
    await proposeExperiments({ llm, journal }, v01, split);
    const prompt = calls[0].messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('discovery note');
    expect(prompt).toContain('earlier idea');
    expect(prompt).not.toMatch(/HOLDOUT_REVIEW_TEXT|123456|holdout-trade|2026-10-05|HOLDOUT_METRIC_999/);
  });
  it('the proposal module reads the journal only through the discovery loader (source scan)', () => {
    const text = readFileSync('lib/ltp-agent/experiments.ts', 'utf8');
    expect(text).not.toMatch(/\b(decisionsForDay|outcomesForDay|outcomesForDecision|reviewFor|decisionById|closedTrades|closedTradesBetween)\b/);
    expect(text).toMatch(/discoverySet/);
  });
});

describe('experiments are never deleted, and the file matches the stored record', () => {
  it('the journal has no way to delete or remove an experiment', () => {
    const { journal } = freshStores();
    expect(Object.keys(journal).filter((k) => /delete|remove|drop/i.test(k) && /experiment/i.test(k))).toEqual([]);
    expect(readFileSync('lib/ltp-agent/journal-store.ts', 'utf8')).not.toMatch(/DELETE FROM agent_experiments/i);
  });
  it('the exported file is exactly the serialised record, named EXP-###.json', async () => {
    const journal = await learning();
    const r = await proposeExperiments({ llm: fakeLlm([reply(proposal({ touch_tolerance_pts: 8 }))]).llm, journal }, v01, split);
    const stored = (await journal.getExperiment('EXP-001'))!;
    expect(experimentFileName('EXP-001')).toBe('EXP-001.json');
    const dir = mkdtempSync(join(tmpdir(), 'exp-'));
    writeExperimentFile(r.experiments[0], dir);
    expect(readFileSync(join(dir, 'EXP-001.json'), 'utf8')).toBe(serializeExperiment(stored));
    expect(JSON.parse(readFileSync(join(dir, 'EXP-001.json'), 'utf8'))).toEqual(stored);
    rmSync(dir, { recursive: true });
  });
});
