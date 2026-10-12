// Shapes shared by the experiment modules. Type-only: no logic, so the store and the gate can both import it without a cycle.
import type { Split } from './holdout';

export type Metrics = { n: number; winRate: number; expectancy: number; profitFactor: number | null; maxDrawdown: number; netPnl: number };
export type GateCriterion = { name: string; passed: boolean; value: number | string | null; threshold: string };
export type BookGate = {
  passed: boolean; criteria: GateCriterion[]; candidate: Metrics; current: Metrics;
  expectancyDiff: { mean: number; lo90: number; hi90: number }; weakEvidence: boolean; baselinePercentile: number | null;
};
export type GateResult = { ranAt: number; holdoutDays: string[]; triedCount: number; buy: BookGate; sell: BookGate };

export type ExperimentStatus = 'proposed' | 'running' | 'awaiting_approval' | 'rejected_by_gate' | 'approved' | 'rejected';
export type Experiment = {
  id: string; hypothesis: string; diff: Record<string, unknown>; expectedEffect: string; evidence: string[]; baseVersion: string;
  split: Split; status: ExperimentStatus; results?: GateResult; triedCount: number; createdTs: number; appliedVersion?: string;
};
