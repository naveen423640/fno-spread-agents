import { describe, expect, it } from 'vitest';

import { summarizeRun, type RunResponse } from './run-view';

const run = (status: RunResponse['run']['status']): RunResponse['run'] => ({ id: 'r1', symbol: 'NSE:TCS-EQ', asOf: '2026-10-02', tradingDate: '2026-10-02', status, candidate: {}, promptSet: 'agents-v1', createdAt: 't', completedAt: null });
const step = (role: string, status: 'ok' | 'failed' | 'unavailable', output: unknown = null, error: string | null = null) => ({ role, status, output, error, startedAt: 't' });
const report = (role: string) => ({ role, summary: `${role} summary`, claims: [], missing_evidence: [] });
const verdict = { verdict: 'REDUCE' as const, reduce_to_lots: 2, reasons: [{ claim: 'regime supports it', type: 'fact' as const, source_ids: ['regime-1'] }], missing_evidence: ['no fundamentals'], confidence_note: 'moderate' };
const sources = [{ id: 'regime-1', kind: 'regime' as const, title: 'Regime', url: null, retrieved_at: 't' }];
const data = (status: RunResponse['run']['status'], steps: RunResponse['steps'] = [], extra: Partial<RunResponse> = {}): RunResponse => ({ run: run(status), steps, sources, verdict: null, ...extra });

describe('summarizeRun', () => {
  it('shows analysts as the first phase with every card pending', () => {
    const view = summarizeRun(data('running'));
    expect(view.phase).toBe('analysts');
    expect(view.analystCards.map((card) => [card.role, card.status])).toEqual([['technical', 'pending'], ['options_oi', 'pending'], ['news', 'pending'], ['fundamentals', 'pending']]);
  });

  it('moves through debate, trader and risk as steps appear', () => {
    const analysts = [step('technical', 'ok', report('technical')), step('options_oi', 'ok', report('options_oi')), step('news', 'ok', report('news')), step('fundamentals', 'unavailable', null, 'no verified source yet')];
    expect(summarizeRun(data('running', analysts)).phase).toBe('debate');
    const debated = [...analysts, step('bull', 'ok', { text: 'bull case' }), step('bear', 'ok', { text: 'bear case' })];
    const mid = summarizeRun(data('running', debated));
    expect(mid.phase).toBe('debate');
    expect(mid.debate).toEqual([{ role: 'bull', text: 'bull case' }, { role: 'bear', text: 'bear case' }]);
    const traded = summarizeRun(data('running', [...debated, step('trader', 'ok', { text: 'proposal' })]));
    expect(traded.phase).toBe('risk');
    expect(traded.proposal).toBe('proposal');
  });

  it('keeps unavailable analyst reasons and ok summaries on their cards', () => {
    const view = summarizeRun(data('running', [step('technical', 'ok', report('technical')), step('fundamentals', 'unavailable', null, 'no verified source yet'), step('news', 'failed', null, 'reply was not valid JSON')]));
    expect(view.analystCards.find((card) => card.role === 'technical')).toMatchObject({ status: 'ok', summary: 'technical summary' });
    expect(view.analystCards.find((card) => card.role === 'fundamentals')).toMatchObject({ status: 'unavailable', reason: 'no verified source yet' });
    expect(view.analystCards.find((card) => card.role === 'news')).toMatchObject({ status: 'failed', reason: 'reply was not valid JSON' });
  });

  it('is done with the verdict and sources once completed', () => {
    const view = summarizeRun(data('completed', [step('risk_pm', 'ok', verdict)], { verdict }));
    expect(view.phase).toBe('done');
    expect(view.verdict).toEqual(verdict);
    expect(view.verdict?.reasons[0].source_ids).toEqual(['regime-1']);
    expect(view.sources).toEqual(sources);
  });

  it('reports ai_unavailable with the stored reason', () => {
    const view = summarizeRun(data('ai_unavailable', [step('run', 'unavailable', null, 'technical analyst unavailable: FYERS is not connected')]));
    expect(view.phase).toBe('unavailable');
    expect(view.reason).toContain('FYERS is not connected');
  });

  it('reports a failed run with its error', () => {
    const view = summarizeRun(data('failed', [step('run', 'failed', null, 'gather exploded')]));
    expect(view.phase).toBe('failed');
    expect(view.reason).toBe('gather exploded');
  });

  it('treats an unknown response as starting', () => {
    expect(summarizeRun(null).phase).toBe('starting');
  });
});
