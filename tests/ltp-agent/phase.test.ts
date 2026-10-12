import { describe, expect, it } from 'vitest';

import { assertLearning, phaseOf, PhaseLockedError, REQUIRED_TRADES } from '@/lib/ltp-agent/phase';
import type { ClosedTrade } from '@/lib/ltp-agent/books';
import { freshStores } from '../support/ltp-agent-day';
import { makeDecision } from '../support/ltp-agent-journal';

const closed = (net: number): ClosedTrade => ({ book: 'buy', underlying: 'NSE:NIFTY50-INDEX', direction: 'long', date: '2026-10-12', openedTs: 1, closedTs: 2, qty: 65, legs: [], grossPnl: net, charges: { brokerage: 0, stt: 0, exchange: 0, sebi: 0, gst: 0, stamp: 0, total: 0 }, netPnl: net, plannedRiskInr: 100, rMultiple: 0, maeSpot: 0, mfeSpot: 0, maeInr: 0, mfeInr: 0, holdingMinutes: 1, exitReason: 'target', fillQuality: 'quote' });

describe('the phase follows the closed-trade counter of the strategy version', () => {
  it('the journal phase shows the counter, up to 99', () => {
    expect(REQUIRED_TRADES).toBe(100);
    expect(phaseOf(0)).toEqual({ phase: 'journal', counter: 'Journal phase: 0 / 100 trades', unlocked: false });
    expect(phaseOf(37)).toEqual({ phase: 'journal', counter: 'Journal phase: 37 / 100 trades', unlocked: false });
    expect(phaseOf(99)).toMatchObject({ phase: 'journal', counter: 'Journal phase: 99 / 100 trades' });
  });
  it('it unlocks at exactly 100 and stays unlocked', () => {
    expect(phaseOf(100)).toEqual({ phase: 'learning', counter: 'Learning phase', unlocked: true });
    expect(phaseOf(250).phase).toBe('learning');
  });
});

describe('assertLearning rejects work before 100 closed trades and allows it at exactly 100', () => {
  const fill = async (journal: ReturnType<typeof freshStores>['journal'], n: number) => {
    for (let i = 0; i < n; i += 1) {
      const d = makeDecision({ decisionId: `d${i}`, ts: 1791780000 + i });
      await journal.recordDecision(d);
      await journal.recordTrade({ decisionId: d.decisionId, book: 'buy', status: 'open', openedTs: d.ts, position: {} });
      await journal.recordOutcome(d.decisionId, 'buy', closed(10));
    }
  };
  it('99 closed trades: locked, with the counter in the message', async () => {
    const { journal } = freshStores();
    await fill(journal, 99);
    await expect(assertLearning(journal, '0.1')).rejects.toThrow(PhaseLockedError);
    await expect(assertLearning(journal, '0.1')).rejects.toThrow(/99 \/ 100/);
  });
  it('100 closed trades: unlocked', async () => {
    const { journal } = freshStores();
    await fill(journal, 100);
    await expect(assertLearning(journal, '0.1')).resolves.toBeUndefined();
  });
  it('trades of another strategy version do not count', async () => {
    const { journal } = freshStores();
    await fill(journal, 100);
    await expect(assertLearning(journal, '0.2')).rejects.toThrow(PhaseLockedError);
  });
});
