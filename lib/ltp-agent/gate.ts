// The experiment gate. A candidate strategy is replayed against the current one over the same held-out days and judged per book. Every criterion
// is listed with its value; "weak evidence" is flagged when the interval of the expectancy difference includes 0. Deterministic: the same inputs
// (including the seeds) always give the same result. The holdout days are used here and nowhere that the LLM can see.
import type { LtpStore } from '@/lib/ltp/store';
import { istHhmm } from '@/lib/ltp/time';
import type { ExtensionMethod } from '@/lib/ltp/extensions';
import type { SessionAnalysis } from '@/lib/ltp/analyze';
import { UNDERLYINGS } from '@/lib/ltp/recorder';
import { agentReplayDay } from './agent';
import { randomBaseline, type TradeSpec } from './baseline';
import { bootstrapDiff } from './bootstrap';
import type { Book } from './books';
import type { BookGate, Experiment, GateCriterion, GateResult } from './experiment-types';
import type { JournalStore } from './journal-store';
import { createMemoryJournal } from './memory-journal';
import { metricsOf, percentileOf } from './metrics';
import { assertLearning } from './phase';
import { ensureSplit } from './versions';
import { applyDiff, type Strategy } from './strategy';

export const MIN_HOLDOUT_TRADES = 30;
export const BASELINE_MIN_PERCENTILE = 90;
export const MAX_DRAWDOWN_SLACK = 1.1;
const BOOTSTRAP_SEED = 20261012;

// One book's verdict. `candidate` and `current` are the net P&L of each version's trades in close order.
export function judgeBook(a: { candidate: number[]; current: number[]; baselinePercentile: number | null; seed: number; iterations?: number }): BookGate {
  const candidate = metricsOf(a.candidate);
  const current = metricsOf(a.current);
  const ci = bootstrapDiff(a.candidate, a.current, a.seed, a.iterations);
  const pf = (m: typeof candidate) => (m.profitFactor === null ? Infinity : m.profitFactor);
  const criteria: GateCriterion[] = [
    { name: 'holdout_trades', passed: candidate.n >= MIN_HOLDOUT_TRADES, value: candidate.n, threshold: `at least ${MIN_HOLDOUT_TRADES}` },
    { name: 'expectancy_vs_current', passed: candidate.expectancy > current.expectancy, value: candidate.expectancy, threshold: `above ${current.expectancy.toFixed(2)} (current)` },
    { name: 'profit_factor', passed: pf(candidate) >= pf(current), value: candidate.profitFactor, threshold: `at least ${current.profitFactor === null ? 'unbounded' : current.profitFactor.toFixed(2)} (current)` },
    { name: 'max_drawdown', passed: candidate.maxDrawdown <= current.maxDrawdown * MAX_DRAWDOWN_SLACK, value: candidate.maxDrawdown, threshold: `at most ${(current.maxDrawdown * MAX_DRAWDOWN_SLACK).toFixed(2)} (current + 10%)` },
    { name: 'random_baseline', passed: a.baselinePercentile !== null && a.baselinePercentile >= BASELINE_MIN_PERCENTILE, value: a.baselinePercentile, threshold: `percentile at least ${BASELINE_MIN_PERCENTILE}` },
    { name: 'beats_no_trade', passed: candidate.expectancy > 0 && candidate.netPnl > 0, value: candidate.expectancy, threshold: 'expectancy above 0 (no trade earns 0)' },
  ];
  return { passed: criteria.every((c) => c.passed), criteria, candidate, current, expectancyDiff: ci, weakEvidence: ci.lo90 <= 0 && ci.hi90 >= 0, baselinePercentile: a.baselinePercentile };
}

export type GateDeps = {
  store: LtpStore; current: Strategy; candidate: Strategy; holdoutDays: string[]; underlyings?: string[]; method?: ExtensionMethod;
  seeds?: number; bootstrapIterations?: number; triedCount: number; now?: () => number;
};

async function replayAll(deps: GateDeps, strategy: Strategy, cache: Map<string, SessionAnalysis>) {
  const journal = createMemoryJournal();
  const ctx = { store: deps.store, journal, strategy, paused: false, method: deps.method, analysisCache: cache };
  for (const day of deps.holdoutDays) for (const u of deps.underlyings ?? UNDERLYINGS) await agentReplayDay(ctx, u, day);
  const outcomes = (await Promise.all(deps.holdoutDays.map((d) => journal.outcomesForDay(d)))).flat();
  const decisions = (await Promise.all(deps.holdoutDays.map((d) => journal.decisionsForDay(d)))).flat();
  const nets = (book: Book) => outcomes.filter((o) => o.book === book).sort((a, b) => a.closedTs - b.closedTs || a.decisionId.localeCompare(b.decisionId)).map((o) => o.netPnl);
  return { buy: nets('buy'), sell: nets('sell'), decisions };
}

export async function runGate(deps: GateDeps): Promise<GateResult> {
  const cache = new Map<string, SessionAnalysis>();
  const current = await replayAll(deps, deps.current, cache);
  const candidate = await replayAll(deps, deps.candidate, cache);
  const specs: TradeSpec[] = candidate.decisions.filter((d) => d.taken).flatMap((d) => {
    const e = d.expectation as { plannedRiskPts?: number | null; rewardPts?: number | null };
    return typeof e.plannedRiskPts === 'number' && typeof e.rewardPts === 'number' ? [{ underlying: d.underlying, hhmm: istHhmm(d.ts), plannedRiskPts: e.plannedRiskPts, rewardPts: e.rewardPts }] : [];
  });
  const baseline = specs.length ? await randomBaseline({ specs, days: deps.holdoutDays, store: deps.store, strategy: deps.candidate, seeds: deps.seeds }) : { buy: [], sell: [] };
  const book = (b: Book) => judgeBook({ candidate: candidate[b], current: current[b], baselinePercentile: percentileOf(metricsOf(candidate[b]).expectancy, baseline[b]), seed: BOOTSTRAP_SEED, iterations: deps.bootstrapIterations });
  return { ranAt: (deps.now ?? (() => Math.floor(Date.now() / 1000)))(), holdoutDays: deps.holdoutDays, triedCount: deps.triedCount, buy: book('buy'), sell: book('sell') };
}

// Runs one proposed experiment through the gate and records the verdict: awaiting_approval if either book passed, otherwise rejected_by_gate.
export async function runExperiment(deps: { store: LtpStore; journal: JournalStore; current: Strategy; method?: ExtensionMethod; seeds?: number; bootstrapIterations?: number; now?: () => number; underlyings?: string[] }, id: string): Promise<Experiment> {
  const experiment = await deps.journal.getExperiment(id);
  if (!experiment) throw new Error(`No experiment ${id}.`);
  if (experiment.status !== 'proposed') throw new Error(`Experiment ${id} is ${experiment.status}; only a proposed experiment can be run.`);
  if (deps.current.version !== experiment.baseVersion) throw new Error(`Experiment ${id} was proposed against version ${experiment.baseVersion}, but ${deps.current.version} is active.`);
  await assertLearning(deps.journal, experiment.baseVersion);
  // An owner idea added before there were two recorded days has no held-out days yet: take them now (the version's stored split).
  const split = experiment.split.holdout.length ? experiment.split : await ensureSplit(deps, experiment.baseVersion);
  await deps.journal.saveExperiment({ ...experiment, split, status: 'running' });
  const triedCount = (await deps.journal.listExperiments()).length;
  const results = await runGate({ store: deps.store, current: deps.current, candidate: applyDiff(deps.current, experiment.diff), holdoutDays: split.holdout, underlyings: deps.underlyings, method: deps.method, seeds: deps.seeds, bootstrapIterations: deps.bootstrapIterations, triedCount, now: deps.now });
  const done: Experiment = { ...experiment, split, status: results.buy.passed || results.sell.passed ? 'awaiting_approval' : 'rejected_by_gate', results, triedCount };
  await deps.journal.saveExperiment(done);
  return done;
}
