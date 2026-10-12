import { describe, expect, it } from 'vitest';

import { discoverySet, splitDays } from '@/lib/ltp-agent/holdout';
import type { ClosedTrade } from '@/lib/ltp-agent/books';
import { freshStores } from '../support/ltp-agent-day';
import { makeDecision } from '../support/ltp-agent-journal';

describe('splitDays: the chronologically last 30% of recorded days is the holdout', () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  it('10 days: 7 for discovery, the last 3 held out, in date order even if given shuffled', () => {
    const shuffled = [...days(10)].reverse();
    const s = splitDays(shuffled);
    expect(s.discovery).toEqual(days(10).slice(0, 7));
    expect(s.holdout).toEqual(days(10).slice(7));
  });
  it('rounds the holdout to the nearest whole day, with at least one day on each side', () => {
    expect(splitDays(days(2))).toEqual({ discovery: ['2026-10-01'], holdout: ['2026-10-02'] });
    expect(splitDays(days(5)).holdout).toHaveLength(2); // 1.5 rounds to 2
    expect(splitDays(days(3)).holdout).toHaveLength(1);
  });
  it('fewer than 2 days cannot be split, and duplicates count once', () => {
    expect(() => splitDays(['2026-10-01'])).toThrow(/at least 2/);
    expect(() => splitDays(['2026-10-01', '2026-10-01'])).toThrow(/at least 2/);
  });
});

describe('the discovery loader can never return a holdout trade', () => {
  const outcome = (date: string): ClosedTrade => ({ book: 'buy', underlying: 'NSE:NIFTY50-INDEX', direction: 'long', date, openedTs: 1, closedTs: 2, qty: 65, legs: [], grossPnl: 10, charges: { brokerage: 0, stt: 0, exchange: 0, sebi: 0, gst: 0, stamp: 0, total: 0 }, netPnl: 10, plannedRiskInr: 100, rMultiple: 0.1, maeSpot: 0, mfeSpot: 0, maeInr: 0, mfeInr: 0, holdingMinutes: 1, exitReason: 'target', fillQuality: 'quote' });
  async function seeded() {
    const { journal } = freshStores();
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03']) {
      const d = makeDecision({ decisionId: `id-${date}`, tradeDate: date, ts: Date.parse(`${date}T05:00:00Z`) / 1000 });
      await journal.recordDecision(d);
      await journal.recordTrade({ decisionId: d.decisionId, book: 'buy', status: 'open', openedTs: d.ts, position: {} });
      await journal.recordOutcome(d.decisionId, 'buy', outcome(date));
      await journal.recordReview(d.decisionId, { outcome_class: 'bad_trade', mistake_tags: ['stop_too_tight'], what_happened: `note for ${date}`, lesson: 'x', confidence: 0.5 }, 'm');
    }
    return journal;
  }
  const split = { discovery: ['2026-10-01', '2026-10-02'], holdout: ['2026-10-03'] };

  it('returns only discovery-day trades, with their reviews', async () => {
    const set = await discoverySet(await seeded(), '0.1', split);
    expect(set.trades.map((t) => t.date).sort()).toEqual(['2026-10-01', '2026-10-02']);
    expect(set.trades.every((t) => t.review !== null)).toBe(true);
  });
  it('the exclusion is in the query: the store itself does not return holdout rows when asked to exclude them', async () => {
    const journal = await seeded();
    const rows = await journal.closedTrades({ version: '0.1', excludeDays: split.holdout });
    expect(rows.map((r) => r.decision.tradeDate).sort()).toEqual(['2026-10-01', '2026-10-02']);
  });
  it('a holdout row injected after the split (a new outcome, a new review, even a new decision) never comes back', async () => {
    const journal = await seeded();
    const sneaky = makeDecision({ decisionId: 'sneaky', tradeDate: '2026-10-03', ts: Date.parse('2026-10-03T06:00:00Z') / 1000 });
    await journal.recordDecision(sneaky);
    await journal.recordTrade({ decisionId: 'sneaky', book: 'sell', status: 'open', openedTs: sneaky.ts, position: {} });
    await journal.recordOutcome('sneaky', 'sell', { ...outcome('2026-10-03'), book: 'sell', netPnl: 999999 });
    await journal.recordReview('sneaky', { lesson: 'leak' }, 'm');
    const set = await discoverySet(journal, '0.1', split);
    expect(set.trades.map((t) => t.decisionId)).not.toContain('sneaky');
    expect(JSON.stringify(set)).not.toMatch(/2026-10-03|leak|999999/); // nothing from the holdout day, not even its date
  });
  it('a day that is in neither list (recorded after the split) counts as discovery, not holdout', async () => {
    const journal = await seeded();
    const later = makeDecision({ decisionId: 'later', tradeDate: '2026-10-09', ts: Date.parse('2026-10-09T06:00:00Z') / 1000 });
    await journal.recordDecision(later);
    await journal.recordTrade({ decisionId: 'later', book: 'buy', status: 'open', openedTs: later.ts, position: {} });
    await journal.recordOutcome('later', 'buy', outcome('2026-10-09'));
    expect((await discoverySet(journal, '0.1', split)).trades.map((t) => t.decisionId)).toContain('later');
  });
});
