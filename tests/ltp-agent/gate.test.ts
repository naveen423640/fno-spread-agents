import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { agentReplayDay } from '@/lib/ltp-agent/agent';
import { randomBaseline, type TradeSpec } from '@/lib/ltp-agent/baseline';
import { judgeBook, runExperiment, runGate, BASELINE_MIN_PERCENTILE, MIN_HOLDOUT_TRADES } from '@/lib/ltp-agent/gate';
import { createMemoryJournal } from '@/lib/ltp-agent/memory-journal';
import { applyDiff, parseStrategy } from '@/lib/ltp-agent/strategy';
import type { Experiment } from '@/lib/ltp-agent/experiment-types';
import { writerBreakeven } from '@/lib/ltp/extensions';
import { istTs } from '@/lib/ltp/time';
import { DAY, freshStores, pathDay, U } from '../support/ltp-agent-day';
import { seedClosedTrades } from '../support/ltp-agent-journal';

const v01 = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const WINNER: [string, number][] = [['10:00', 23880], ['10:01', 23862], ['10:02', 23900], ['10:03', 24100], ['10:04', 24260], ['10:05', 24260]];

// 40 trades whose P&L is 100 +/- noise for the candidate and 60 +/- noise for the current version.
const series = (base: number, n = 40) => Array.from({ length: n }, (_, i) => base + ((i * 37) % 21) - 10);

describe('judgeBook: every criterion of the gate, one at a time', () => {
  const good = () => judgeBook({ candidate: series(100), current: series(60), baselinePercentile: 95, seed: 1 });
  it('passes when every criterion holds, and lists each criterion with its value', () => {
    const g = good();
    expect(g.passed).toBe(true);
    expect(g.criteria.map((c) => c.name)).toEqual(['holdout_trades', 'expectancy_vs_current', 'profit_factor', 'max_drawdown', 'random_baseline', 'beats_no_trade']);
    expect(g.criteria.every((c) => c.passed)).toBe(true);
    expect(g.expectancyDiff.mean).toBeCloseTo(40, 0);
  });
  it('needs at least 30 holdout trades: 29 fails, 30 passes', () => {
    expect(judgeBook({ candidate: series(100, 29), current: series(60), baselinePercentile: 95, seed: 1 }).criteria[0]).toMatchObject({ name: 'holdout_trades', passed: false, value: 29 });
    expect(MIN_HOLDOUT_TRADES).toBe(30);
    expect(judgeBook({ candidate: series(100, 30), current: series(60), baselinePercentile: 95, seed: 1 }).criteria[0].passed).toBe(true);
  });
  it('expectancy must beat the current version after costs', () => {
    expect(judgeBook({ candidate: series(50), current: series(60), baselinePercentile: 95, seed: 1 }).criteria[1].passed).toBe(false);
  });
  it('profit factor must be at least the current one', () => {
    // Fewer, bigger losses for the current version give it the higher profit factor even though the candidate earns more on average.
    const current = [...Array(35).fill(10), ...Array(5).fill(-1)];
    const candidate = [...Array(20).fill(40), ...Array(20).fill(-10)];
    const g = judgeBook({ candidate, current, baselinePercentile: 95, seed: 1 });
    expect(g.candidate.expectancy).toBeGreaterThan(g.current.expectancy);
    expect(g.criteria.find((c) => c.name === 'profit_factor')?.passed).toBe(false);
  });
  it('max drawdown may be up to 10% worse than the current one: exactly 10% passes, a little more fails', () => {
    const current = [100, 100, -100, 100, ...Array(36).fill(10)];          // drawdown 100
    const within = [100, 100, -110, 100, ...Array(36).fill(14)];            // drawdown 110
    const beyond = [100, 100, -111, 100, ...Array(36).fill(14)];            // drawdown 111
    expect(judgeBook({ candidate: within, current, baselinePercentile: 95, seed: 1 }).criteria.find((c) => c.name === 'max_drawdown')?.passed).toBe(true);
    expect(judgeBook({ candidate: beyond, current, baselinePercentile: 95, seed: 1 }).criteria.find((c) => c.name === 'max_drawdown')?.passed).toBe(false);
  });
  it('must beat the random-entry baseline: the percentile is reported and 90 is the bar', () => {
    expect(BASELINE_MIN_PERCENTILE).toBe(90);
    expect(judgeBook({ candidate: series(100), current: series(60), baselinePercentile: 89, seed: 1 }).criteria.find((c) => c.name === 'random_baseline')).toMatchObject({ passed: false, value: 89 });
    expect(judgeBook({ candidate: series(100), current: series(60), baselinePercentile: 90, seed: 1 }).criteria.find((c) => c.name === 'random_baseline')?.passed).toBe(true);
    expect(judgeBook({ candidate: series(100), current: series(60), baselinePercentile: null, seed: 1 }).criteria.find((c) => c.name === 'random_baseline')?.passed).toBe(false);
  });
  it('must also beat "no trade": a candidate that is better than the current version but loses money fails', () => {
    const g = judgeBook({ candidate: series(-20), current: series(-60), baselinePercentile: 95, seed: 1 });
    expect(g.criteria.find((c) => c.name === 'expectancy_vs_current')?.passed).toBe(true);
    expect(g.criteria.find((c) => c.name === 'beats_no_trade')?.passed).toBe(false);
    expect(g.passed).toBe(false);
  });
  it('weak evidence: set when the 90% interval of the expectancy difference includes 0, never hidden', () => {
    const noisy = (shift: number) => Array.from({ length: 40 }, (_, i) => (i % 2 ? 300 : -250) + shift);
    const weak = judgeBook({ candidate: noisy(5), current: noisy(0), baselinePercentile: 95, seed: 1 });
    expect(weak.weakEvidence).toBe(true);
    expect(weak.expectancyDiff.lo90).toBeLessThanOrEqual(0);
    expect(good().weakEvidence).toBe(false);
  });
});

describe('randomBaseline: seeded, same count and times of day, same exits', () => {
  async function oneDay() {
    const { store, journal } = freshStores();
    for (const s of pathDay([...WINNER, ['10:06', 24000], ['10:07', 24000]])) await store.insertSnapshot(s);
    return { store, journal };
  }
  const spec: TradeSpec = { underlying: U, hhmm: '10:01', plannedRiskPts: 100, rewardPts: 200 };
  it('the same seeds give identical results, different seeds different ones, and 200 seeds are run by default', async () => {
    const { store } = await oneDay();
    const run = (seeds: number) => randomBaseline({ specs: [spec, { ...spec, hhmm: '10:02' }], days: [DAY], store, strategy: v01, seeds });
    const a = await run(200);
    expect(a.buy).toHaveLength(200);
    expect(a.sell).toHaveLength(200);
    expect(await run(200)).toEqual(a);
    expect(new Set(a.buy).size).toBeGreaterThan(1);
  });
  it('a spec with no snapshot at its time on any day contributes nothing', async () => {
    const { store } = await oneDay();
    const r = await randomBaseline({ specs: [{ ...spec, hhmm: '03:00' }], days: [DAY], store, strategy: v01, seeds: 10 });
    expect(r.buy.every((x) => x === 0)).toBe(true);
  });
});

describe('runGate replays the candidate and the current version over the same holdout days', () => {
  async function setup() {
    const { store, journal } = freshStores();
    for (const s of pathDay(WINNER)) await store.insertSnapshot(s);
    return { store, journal };
  }
  const deps = (store: Awaited<ReturnType<typeof setup>>['store']) => ({ store, current: v01, candidate: applyDiff(v01, { touch_tolerance_pts: 8 }), holdoutDays: [DAY], underlyings: [U], method: writerBreakeven, seeds: 20, bootstrapIterations: 300, triedCount: 3, now: () => 1000 });

  it('gives a per-book verdict with the criteria, the holdout days and the tried count', async () => {
    const { store } = await setup();
    const r = await runGate(deps(store));
    expect(r).toMatchObject({ ranAt: 1000, holdoutDays: [DAY], triedCount: 3 });
    expect(r.buy.criteria).toHaveLength(6);
    expect(r.buy.candidate.n).toBe(1);
    expect(r.buy.passed).toBe(false); // one trade is far below the 30 required
    expect(r.buy.criteria[0]).toMatchObject({ name: 'holdout_trades', passed: false, value: 1 });
  });
  it('the same experiment run twice gives identical metrics, intervals and baseline percentile', async () => {
    const { store } = await setup();
    expect(await runGate(deps(store))).toEqual(await runGate(deps(store)));
  });
  it('a candidate identical to the current version cannot beat it: expectancy difference 0', async () => {
    const { store } = await setup();
    const r = await runGate({ ...deps(store), candidate: v01 });
    expect(r.buy.expectancyDiff.mean).toBe(0);
    expect(r.buy.criteria.find((c) => c.name === 'expectancy_vs_current')?.passed).toBe(false);
  });
});

describe('the in-memory journal behaves like the database one, so the gate can run anywhere', () => {
  it('replaying a day into either journal gives the same decisions and outcomes', async () => {
    const { store, journal } = freshStores();
    for (const s of pathDay(WINNER)) await store.insertSnapshot(s);
    const memory = createMemoryJournal();
    await agentReplayDay({ store, journal, strategy: v01, paused: false, method: writerBreakeven }, U, DAY);
    await agentReplayDay({ store, journal: memory, strategy: v01, paused: false, method: writerBreakeven }, U, DAY);
    expect(await memory.decisionsForDay(DAY)).toEqual(await journal.decisionsForDay(DAY));
    expect(await memory.outcomesForDay(DAY)).toEqual(await journal.outcomesForDay(DAY));
  });
  it('a shared analysis cache changes nothing about the result', async () => {
    const { store } = freshStores();
    for (const s of pathDay(WINNER)) await store.insertSnapshot(s);
    const plain = createMemoryJournal();
    const cached = createMemoryJournal();
    await agentReplayDay({ store, journal: plain, strategy: v01, paused: false, method: writerBreakeven }, U, DAY);
    await agentReplayDay({ store, journal: cached, strategy: v01, paused: false, method: writerBreakeven, analysisCache: new Map() }, U, DAY);
    expect(await cached.outcomesForDay(DAY)).toEqual(await plain.outcomesForDay(DAY));
  });
});

describe('runExperiment is locked until 100 closed trades', () => {
  it('99 closed trades: refused, and the experiment stays proposed', async () => {
    const { store, journal } = freshStores();
    await seedClosedTrades(journal, { n: 99, days: ['2026-09-01'] });
    await journal.saveExperiment({ id: 'EXP-001', hypothesis: 'h', diff: { touch_tolerance_pts: 8 }, expectedEffect: 'e', evidence: [], baseVersion: '0.1', split: { discovery: [], holdout: [DAY] }, status: 'proposed', triedCount: 1, createdTs: 1 });
    await expect(runExperiment({ store, journal, current: v01 }, 'EXP-001')).rejects.toThrow(/locked/i);
    expect((await journal.getExperiment('EXP-001'))?.status).toBe('proposed');
  });
});

describe('runExperiment moves an experiment through the gate', () => {
  it('only a proposed experiment can be run, and it ends rejected_by_gate when no book passes (here: too few trades)', async () => {
    const { store, journal } = freshStores();
    for (const s of pathDay(WINNER)) await store.insertSnapshot(s);
    await seedClosedTrades(journal, { n: 100, days: ['2026-09-01'] });
    const base: Experiment = { id: 'EXP-001', hypothesis: 'h', diff: { touch_tolerance_pts: 8 }, expectedEffect: 'e', evidence: [], baseVersion: '0.1', split: { discovery: [], holdout: [DAY] }, status: 'proposed', triedCount: 1, createdTs: 1 };
    await journal.saveExperiment(base);
    const done = await runExperiment({ store, journal, current: v01, method: writerBreakeven, seeds: 10, bootstrapIterations: 100, now: () => 5 }, 'EXP-001');
    expect(done.status).toBe('rejected_by_gate');
    expect(done.results?.buy.passed).toBe(false);
    expect((await journal.getExperiment('EXP-001'))?.status).toBe('rejected_by_gate');
    await expect(runExperiment({ store, journal, current: v01, method: writerBreakeven }, 'EXP-001')).rejects.toThrow(/only a proposed/);
    await expect(runExperiment({ store, journal, current: v01, method: writerBreakeven }, 'EXP-404')).rejects.toThrow(/EXP-404/);
  });
});

void istTs;
