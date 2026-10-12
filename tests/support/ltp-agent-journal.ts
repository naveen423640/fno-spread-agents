import type { DecisionRecord } from '@/lib/ltp-agent/journal-store';

export const makeDecision = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  decisionId: 'NSE:NIFTY50-INDEX|1791780000|coa1_reversal|long|0.1', ts: 1791780000, tradeDate: '2026-10-12', underlying: 'NSE:NIFTY50-INDEX', strategyVersion: '0.1',
  setup: 'coa1_reversal', direction: 'long', book: 'both', taken: true, skipReason: null,
  context: { spot: 24012, line: { low: 24000, high: 24050 }, support: { strike: 24000, status: 'strong', volumePct: 59.6, oiPct: 75.5 }, scenario: 1, hhmm: '10:42' },
  trace: [{ rule: 'scenario_allowed', inputs: { scenario: 1 }, passed: true }],
  reason: 'LONG NIFTY: test sentence.',
  expectation: { entry: 24012, stop: 23900, target: 24200, plannedRiskPts: 112, rewardPts: 188, rr: 1.68 },
  dataQuality: { snapshotAgeSeconds: 2, historyFrom: '09:47', gaps: 0 },
  ...over,
});
