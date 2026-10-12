import { describe, expect, it } from 'vitest';

import type { ClosedTrade } from '@/lib/ltp-agent/books';
import { createJournalStore, type DecisionRecord } from '@/lib/ltp-agent/journal-store';
import { createD1Fake } from '../support/d1-fake';
import { makeDecision } from '../support/ltp-agent-journal';

const fresh = () => { const db = createD1Fake(['drizzle/0010_ltp_agent.sql']); return { db, store: createJournalStore(db) }; };

const closed = (net: number, book: 'buy' | 'sell' = 'buy'): ClosedTrade => ({
  book, underlying: 'NSE:NIFTY50-INDEX', direction: 'long', date: '2026-10-12', openedTs: 1791780000, closedTs: 1791781500, qty: 65, legs: [],
  grossPnl: net + 60, charges: { brokerage: 40, stt: 10, exchange: 5, sebi: 0.01, gst: 5, stamp: 0.2, total: 60 }, netPnl: net, plannedRiskInr: 6000, rMultiple: net / 6000,
  maeSpot: 10, mfeSpot: 40, maeInr: 300, mfeInr: 1200, holdingMinutes: 25, exitReason: 'target', fillQuality: 'quote',
});

describe('decisions are written once and never change', () => {
  it('a decision round-trips with every field group', async () => {
    const { store } = fresh();
    const d = makeDecision();
    await store.recordDecision(d);
    expect(await store.decisionById(d.decisionId)).toEqual(d);
  });
  it('writing the same decision id twice is refused', async () => {
    const { store } = fresh();
    await store.recordDecision(makeDecision());
    await expect(store.recordDecision(makeDecision({ reason: 'different' }))).rejects.toThrow();
  });
  it('a raw UPDATE or DELETE on a decision is aborted by the database itself', async () => {
    const { db, store } = fresh();
    await store.recordDecision(makeDecision());
    await expect(db.prepare("UPDATE agent_decisions SET reason = 'edited'").run()).rejects.toThrow(/immutable/i);
    await expect(db.prepare('DELETE FROM agent_decisions').run()).rejects.toThrow(/immutable/i);
    expect((await store.decisionById(makeDecision().decisionId))?.reason).toBe('LONG NIFTY: test sentence.');
  });
  it('writing an outcome or a review leaves the decision row byte-identical', async () => {
    const { db, store } = fresh();
    const d = makeDecision();
    await store.recordDecision(d);
    const before = JSON.stringify((await db.prepare('SELECT * FROM agent_decisions').all()).results);
    await store.recordTrade({ decisionId: d.decisionId, book: 'buy', status: 'open', openedTs: d.ts, position: { any: 'thing' } });
    await store.recordOutcome(d.decisionId, 'buy', closed(1200));
    await store.recordReview(d.decisionId, { outcome_class: 'good_trade_good_result' }, 'test-model');
    expect(JSON.stringify((await db.prepare('SELECT * FROM agent_decisions').all()).results)).toBe(before);
  });
});

describe('one taken decision, two linked trades', () => {
  it('buy and sell trades and outcomes share the decision id', async () => {
    const { store } = fresh();
    const d = makeDecision();
    await store.recordDecision(d);
    for (const book of ['buy', 'sell'] as const) {
      await store.recordTrade({ decisionId: d.decisionId, book, status: 'open', openedTs: d.ts, position: { book } });
      await store.recordOutcome(d.decisionId, book, closed(book === 'buy' ? 1200 : 400, book));
    }
    const outcomes = await store.outcomesForDecision(d.decisionId);
    expect(outcomes.map((o) => [o.book, o.netPnl])).toEqual([['buy', 1200], ['sell', 400]]);
    expect(outcomes.every((o) => o.decisionId === d.decisionId)).toBe(true);
  });
  it('an outcome is written once per decision and book', async () => {
    const { store } = fresh();
    await store.recordDecision(makeDecision());
    await store.recordOutcome(makeDecision().decisionId, 'buy', closed(100));
    await expect(store.recordOutcome(makeDecision().decisionId, 'buy', closed(999))).rejects.toThrow();
  });
  it('recording an outcome closes the open trade row', async () => {
    const { store } = fresh();
    const d = makeDecision();
    await store.recordDecision(d);
    await store.recordTrade({ decisionId: d.decisionId, book: 'buy', status: 'open', openedTs: d.ts, position: { p: 1 } });
    expect(await store.openTrades('NSE:NIFTY50-INDEX', '2026-10-12')).toHaveLength(1);
    await store.recordOutcome(d.decisionId, 'buy', closed(100));
    expect(await store.openTrades('NSE:NIFTY50-INDEX', '2026-10-12')).toHaveLength(0);
  });
  it('an open position can be updated as it is marked', async () => {
    const { store } = fresh();
    const d = makeDecision();
    await store.recordDecision(d);
    await store.recordTrade({ decisionId: d.decisionId, book: 'buy', status: 'open', openedTs: d.ts, position: { mae: 0 } });
    await store.updateTradePosition(d.decisionId, 'buy', { mae: 12 });
    expect((await store.openTrades('NSE:NIFTY50-INDEX', '2026-10-12'))[0].position).toEqual({ mae: 12 });
  });
});

describe('closedTradeCount counts taken decisions whose every booked trade is closed, per strategy version', () => {
  it('counts two-book trades only when both books are closed; ignores skipped decisions and other versions', async () => {
    const { store } = fresh();
    const add = async (id: string, over: Partial<DecisionRecord>, books: { book: 'buy' | 'sell'; close: boolean }[]) => {
      const d = makeDecision({ decisionId: id, ...over });
      await store.recordDecision(d);
      for (const b of books) {
        await store.recordTrade({ decisionId: id, book: b.book, status: 'open', openedTs: d.ts, position: {} });
        if (b.close) await store.recordOutcome(id, b.book, closed(10, b.book));
      }
    };
    await add('a', {}, [{ book: 'buy', close: true }, { book: 'sell', close: true }]);
    await add('b', {}, [{ book: 'buy', close: true }, { book: 'sell', close: false }]);
    await add('c', { taken: false, skipReason: 'hit_number' }, []);
    await add('d', { strategyVersion: '0.2' }, [{ book: 'buy', close: true }, { book: 'sell', close: true }]);
    await add('e', {}, [{ book: 'buy', close: true }]); // the sell book could not be opened (no hedge quote): one book is enough
    expect(await store.closedTradeCount('0.1')).toBe(2);
    expect(await store.closedTradeCount('0.2')).toBe(1);
  });
});

describe('reviews and state', () => {
  it('a review is stored once per decision', async () => {
    const { store } = fresh();
    await store.recordDecision(makeDecision());
    await store.recordReview(makeDecision().decisionId, { lesson: 'x' }, 'm');
    expect(await store.reviewFor(makeDecision().decisionId)).toEqual({ lesson: 'x' });
    await expect(store.recordReview(makeDecision().decisionId, { lesson: 'y' }, 'm')).rejects.toThrow();
  });
  it('state keys read back, and an unset key is null', async () => {
    const { store } = fresh();
    expect(await store.getState('paused')).toBeNull();
    await store.setState('paused', 'true');
    await store.setState('paused', 'false');
    expect(await store.getState('paused')).toBe('false');
  });
  it('decisionsForDay lists one day in time order, optionally for one underlying', async () => {
    const { store } = fresh();
    await store.recordDecision(makeDecision({ decisionId: 'b', ts: 20 }));
    await store.recordDecision(makeDecision({ decisionId: 'a', ts: 10 }));
    await store.recordDecision(makeDecision({ decisionId: 'c', ts: 30, underlying: 'NSE:NIFTYBANK-INDEX' }));
    expect((await store.decisionsForDay('2026-10-12')).map((d) => d.decisionId)).toEqual(['a', 'b', 'c']);
    expect((await store.decisionsForDay('2026-10-12', 'NSE:NIFTYBANK-INDEX')).map((d) => d.decisionId)).toEqual(['c']);
  });
});
