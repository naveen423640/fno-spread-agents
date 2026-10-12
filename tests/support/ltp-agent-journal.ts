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

import type { ClosedTrade } from '@/lib/ltp-agent/books';
import type { JournalStore } from '@/lib/ltp-agent/journal-store';

export const closedTrade = (net: number, date = '2026-10-12', book: 'buy' | 'sell' = 'buy'): ClosedTrade => ({
  book, underlying: 'NSE:NIFTY50-INDEX', direction: 'long', date, openedTs: 1791780000, closedTs: 1791781500, qty: 65, legs: [],
  grossPnl: net, charges: { brokerage: 0, stt: 0, exchange: 0, sebi: 0, gst: 0, stamp: 0, total: 0 }, netPnl: net, plannedRiskInr: 1000, rMultiple: net / 1000,
  maeSpot: 0, mfeSpot: 0, maeInr: 0, mfeInr: 0, holdingMinutes: 25, exitReason: 'target', fillQuality: 'quote',
});

// n closed two-book trades of one strategy version, spread over the given days, each with the stated net P&L per book and an optional review.
export async function seedClosedTrades(journal: JournalStore, opts: { n: number; version?: string; days?: string[]; net?: (i: number) => { buy: number; sell: number }; review?: (i: number) => unknown }) {
  const days = opts.days ?? ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
  for (let i = 0; i < opts.n; i += 1) {
    const date = days[i % days.length];
    const id = `seed-${opts.version ?? '0.1'}-${days[0]}-${i}`;
    const d = makeDecision({ decisionId: id, tradeDate: date, ts: Date.parse(`${date}T05:00:00Z`) / 1000 + i, strategyVersion: opts.version ?? '0.1', context: { scenario: 1, hit: 1 + (i % 2), hhmm: '10:42' } });
    await journal.recordDecision(d);
    const net = opts.net?.(i) ?? { buy: 10, sell: 5 };
    for (const book of ['buy', 'sell'] as const) {
      await journal.recordTrade({ decisionId: id, book, status: 'open', openedTs: d.ts, position: {} });
      await journal.recordOutcome(id, book, closedTrade(net[book], date, book));
    }
    const review = opts.review?.(i);
    if (review) await journal.recordReview(id, review, 'm');
  }
}
