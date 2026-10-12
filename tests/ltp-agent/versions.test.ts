import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { approveExperiment, ensureSplit, listVersions, rejectExperiment, rollbackTo } from '@/lib/ltp-agent/versions';
import { assertLearning, PhaseLockedError } from '@/lib/ltp-agent/phase';
import { applyDiff, parseStrategy } from '@/lib/ltp-agent/strategy';
import { loadActiveStrategy, loadStrategy } from '@/lib/ltp-agent/strategy-store';
import type { Experiment } from '@/lib/ltp-agent/experiment-types';
import { DAY, freshStores, pathDay } from '../support/ltp-agent-day';
import { seedClosedTrades } from '../support/ltp-agent-journal';

const v01 = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const exp = (over: Partial<Experiment> = {}): Experiment => ({ id: 'EXP-001', hypothesis: 'A wider touch band catches cleaner entries', diff: { touch_tolerance_pts: 8, 'window.start': '09:45' }, expectedEffect: 'e', evidence: [], baseVersion: '0.1', split: { discovery: [], holdout: [] }, status: 'awaiting_approval', triedCount: 1, createdTs: 1, ...over });
async function ready() {
  const stores = freshStores();
  for (const s of [...pathDay([['10:00', 24037]]), ...pathDay([['10:00', 24037]], '09:15', '2026-10-13')]) await stores.store.insertSnapshot(s);
  await stores.journal.saveExperiment(exp());
  return stores;
}
const flat = (o: unknown, prefix = ''): Record<string, unknown> => (typeof o === 'object' && o !== null && !Array.isArray(o) ? Object.entries(o).reduce((acc, [k, v]) => ({ ...acc, ...flat(v, prefix ? `${prefix}.${k}` : k) }), {}) : { [prefix]: o });

describe('approving an experiment creates the next strategy version', () => {
  it('only an experiment that is awaiting approval can be approved', async () => {
    const { store, journal } = await ready();
    await journal.saveExperiment(exp({ status: 'rejected_by_gate' }));
    await expect(approveExperiment({ store, journal }, 'EXP-001')).rejects.toThrow(/awaiting_approval/);
    await expect(approveExperiment({ store, journal }, 'EXP-404')).rejects.toThrow(/EXP-404/);
  });
  it('writes version 0.2 that differs from 0.1 only in its version and the diff, with a changelog line naming the experiment', async () => {
    const { store, journal } = await ready();
    const r = await approveExperiment({ store, journal }, 'EXP-001');
    expect(r.version).toBe('0.2');
    const next = await loadStrategy(journal, '0.2');
    expect(next).toEqual({ ...applyDiff(v01, { touch_tolerance_pts: 8, 'window.start': '09:45' }), version: '0.2' });
    const changed = Object.keys(flat(next)).filter((k) => JSON.stringify(flat(next)[k]) !== JSON.stringify(flat(v01)[k])).sort();
    expect(changed).toEqual(['touch_tolerance_pts', 'version', 'window.start']);
    const rows = await listVersions(journal);
    expect(rows.find((v) => v.version === '0.2')?.changelog).toMatch(/EXP-001.*touch_tolerance_pts 5 -> 8/);
    expect(await journal.strategyYaml('0.2')).toMatch(/# changelog[\s\S]*EXP-001/);
  });
  it('makes 0.2 the active paper version and marks the experiment approved with the version it created', async () => {
    const { store, journal } = await ready();
    await approveExperiment({ store, journal }, 'EXP-001');
    expect((await loadActiveStrategy(journal)).version).toBe('0.2');
    expect(await journal.getExperiment('EXP-001')).toMatchObject({ status: 'approved', appliedVersion: '0.2' });
  });
  it('stores a fresh split from the recorded days: the last 30% (here the last 1 of 2) is held out for the new version', async () => {
    const { store, journal } = await ready();
    await approveExperiment({ store, journal }, 'EXP-001');
    expect(JSON.parse((await journal.getState('split_0.2'))!)).toEqual({ discovery: [DAY], holdout: ['2026-10-13'] });
  });
  it('the new version starts its own journal phase: experiments are locked again until it has 100 closed trades', async () => {
    const { store, journal } = await ready();
    await seedClosedTrades(journal, { n: 100, days: ['2026-09-01'] });
    await assertLearning(journal, '0.1');
    await approveExperiment({ store, journal }, 'EXP-001');
    await expect(assertLearning(journal, '0.2')).rejects.toThrow(PhaseLockedError);
  });
  it('refuses when the active version is not the one the experiment was proposed against', async () => {
    const { store, journal } = await ready();
    await journal.setState('active_version', '0.1');
    await journal.saveExperiment(exp({ baseVersion: '0.7' }));
    await expect(approveExperiment({ store, journal }, 'EXP-001')).rejects.toThrow(/0\.7/);
  });
  it('a second approval does not overwrite an existing version: the next number is taken', async () => {
    const { store, journal } = await ready();
    await approveExperiment({ store, journal }, 'EXP-001');
    await journal.setState('active_version', '0.1');
    await journal.saveExperiment(exp({ id: 'EXP-002', diff: { stop_buffer_pts: 20 } }));
    expect((await approveExperiment({ store, journal }, 'EXP-002')).version).toBe('0.3');
    expect((await loadStrategy(journal, '0.2')).touch_tolerance_pts).toBe(8);
  });
});

describe('reject and rollback', () => {
  it('rejecting marks the experiment rejected and creates nothing; a proposed experiment can be rejected too', async () => {
    const { journal } = await ready();
    await rejectExperiment(journal, 'EXP-001');
    expect((await journal.getExperiment('EXP-001'))?.status).toBe('rejected');
    expect(await journal.strategyYaml('0.2')).toBeNull();
    await journal.saveExperiment(exp({ id: 'EXP-002', status: 'proposed' }));
    await rejectExperiment(journal, 'EXP-002');
    expect((await journal.getExperiment('EXP-002'))?.status).toBe('rejected');
    await expect(rejectExperiment(journal, 'EXP-001')).rejects.toThrow(/rejected/);
  });
  it('rollback reactivates an older version and keeps the newer one on file', async () => {
    const { store, journal } = await ready();
    await approveExperiment({ store, journal }, 'EXP-001');
    await rollbackTo(journal, '0.1');
    expect((await loadActiveStrategy(journal)).version).toBe('0.1');
    expect((await loadStrategy(journal, '0.2')).version).toBe('0.2');
    expect((await listVersions(journal)).map((v) => [v.version, v.active])).toEqual([['0.1', true], ['0.2', false]]);
    await rollbackTo(journal, '0.2');
    expect((await loadActiveStrategy(journal)).version).toBe('0.2');
  });
  it('rolling back to a version that does not exist is an error', async () => {
    const { journal } = await ready();
    await expect(rollbackTo(journal, '4.2')).rejects.toThrow(/4\.2/);
  });
  it('every change of the active version is kept in a history', async () => {
    const { store, journal } = await ready();
    await approveExperiment({ store, journal }, 'EXP-001');
    await rollbackTo(journal, '0.1');
    const history = JSON.parse((await journal.getState('version_history'))!) as { version: string; via: string }[];
    expect(history.map((h) => [h.version, h.via])).toEqual([['0.2', 'EXP-001'], ['0.1', 'rollback']]);
  });
});

describe('ensureSplit gives a version one fixed split', () => {
  it('computes the split from the recorded days the first time, stores it, and returns the stored one afterwards even when new days arrive', async () => {
    const { store, journal } = await ready();
    const first = await ensureSplit({ store, journal }, '0.1');
    expect(first).toEqual({ discovery: [DAY], holdout: ['2026-10-13'] });
    for (const s of pathDay([['10:00', 24037]], '09:15', '2026-10-14')) await store.insertSnapshot(s);
    expect(await ensureSplit({ store, journal }, '0.1')).toEqual(first);
  });
  it('with fewer than 2 recorded days there is nothing to split yet, and nothing is stored', async () => {
    const { store, journal } = freshStores();
    await store.insertSnapshot(pathDay([['10:00', 24037]])[0]);
    await expect(ensureSplit({ store, journal }, '0.1')).rejects.toThrow(/at least 2/);
    expect(await journal.getState('split_0.1')).toBeNull();
  });
});
