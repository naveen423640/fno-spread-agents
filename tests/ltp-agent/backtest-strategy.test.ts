import { describe, expect, it } from 'vitest';

import { resolveBacktestStrategy } from '@/lib/ltp-agent/backtest-strategy';
import type { Experiment } from '@/lib/ltp-agent/experiment-types';
import { approveExperiment } from '@/lib/ltp-agent/versions';
import { freshStores, pathDay } from '../support/ltp-agent-day';

const exp = (over: Partial<Experiment> = {}): Experiment => ({ id: 'EXP-001', hypothesis: 'wider band', diff: { touch_tolerance_pts: 8 }, expectedEffect: 'e', evidence: [], baseVersion: '0.1', split: { discovery: [], holdout: [] }, status: 'proposed', triedCount: 1, createdTs: 1, ...over });

describe('resolveBacktestStrategy: which strategy a backtest runs', () => {
  it('with no choice it is the active version', async () => {
    const { journal } = freshStores();
    const r = await resolveBacktestStrategy(journal, {});
    expect(r.strategy.version).toBe('2.0'); // the default active version
    expect(r.label).toBe('v2.0');
  });
  it('a stored version, including one created by an approved experiment', async () => {
    const { store, journal } = freshStores();
    for (const s of [...pathDay([['10:00', 24037]]), ...pathDay([['10:00', 24037]], '09:15', '2026-10-13')]) await store.insertSnapshot(s);
    await journal.saveExperiment(exp({ status: 'awaiting_approval' }));
    await journal.setState('active_version', '0.1');
    await approveExperiment({ store, journal }, 'EXP-001');
    await journal.setState('active_version', '0.1');
    const r = await resolveBacktestStrategy(journal, { version: '0.2' });
    expect(r.strategy).toMatchObject({ version: '0.2', touch_tolerance_pts: 8 });
    expect(r.label).toBe('v0.2');
  });
  it('an experiment from the agent, in any status, is its diff applied on the version it was proposed against', async () => {
    const { journal } = freshStores();
    await journal.saveExperiment(exp({ status: 'rejected_by_gate' }));
    const r = await resolveBacktestStrategy(journal, { experiment: 'EXP-001' });
    expect(r.strategy.touch_tolerance_pts).toBe(8);
    expect(r.label).toBe('v0.1 + EXP-001');
  });
  it('your own changes to tunable fields are applied on top, and described in the label', async () => {
    const { journal } = freshStores();
    const r = await resolveBacktestStrategy(journal, { overrides: { max_hit_number: 1, 'window.start': '09:45' } });
    expect(r.strategy).toMatchObject({ max_hit_number: 1, window: { start: '09:45', end: '14:45' } });
    expect(r.label).toBe('v2.0 + changes (max_hit_number=1, window.start=09:45)');
  });
  it('an experiment and your own changes combine', async () => {
    const { journal } = freshStores();
    await journal.saveExperiment(exp());
    const r = await resolveBacktestStrategy(journal, { experiment: 'EXP-001', overrides: { stop_buffer_pts: 20 } });
    expect(r.strategy).toMatchObject({ touch_tolerance_pts: 8, stop_buffer_pts: 20 });
    expect(r.label).toBe('v0.1 + EXP-001 + changes (stop_buffer_pts=20)'); // the experiment was proposed against v0.1, so it is applied there
  });
  it('a field that is not tunable, an out-of-bounds value, an unknown version and an unknown experiment are refused with a clear message', async () => {
    const { journal } = freshStores();
    await expect(resolveBacktestStrategy(journal, { overrides: { 'risk.daily_loss_cap_inr': 1 } })).rejects.toThrow(/not a tunable/);
    await expect(resolveBacktestStrategy(journal, { overrides: { max_hit_number: 9 } })).rejects.toThrow(/between 1 and 5/);
    await expect(resolveBacktestStrategy(journal, { version: '7.7' })).rejects.toThrow(/7\.7/);
    await expect(resolveBacktestStrategy(journal, { experiment: 'EXP-404' })).rejects.toThrow(/EXP-404/);
  });
  it('trying a change never touches the stored strategy or the active version', async () => {
    const { journal } = freshStores();
    await resolveBacktestStrategy(journal, { overrides: { max_hit_number: 1 } });
    expect(await journal.getState('active_version')).toBeNull();
    expect(await journal.listStrategies()).toEqual([]);
  });
});
