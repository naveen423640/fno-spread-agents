// A journal that lives in memory. Replays and the experiment gate use it so they never touch the real journal and can run anywhere (it needs no
// database). It stores JSON copies, like the database journal does, so what comes back is identical to what the database would return.
import type { Book, ClosedTrade } from './books';
import type { AgentJournal, DecisionRecord, OutcomeRow, TradeRow } from './journal-store';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function createMemoryJournal(): AgentJournal {
  const decisions = new Map<string, DecisionRecord>();
  const trades = new Map<string, TradeRow>();
  const outcomes = new Map<string, OutcomeRow>();
  const key = (id: string, book: Book) => `${id}|${book}`;
  return {
    async recordDecision(d) { if (decisions.has(d.decisionId)) throw new Error('UNIQUE: decision already recorded'); decisions.set(d.decisionId, copy(d)); },
    async decisionById(id) { const d = decisions.get(id); return d ? copy(d) : null; },
    async decisionsForDay(date, underlying) {
      return [...decisions.values()].filter((d) => d.tradeDate === date && (!underlying || d.underlying === underlying)).sort((a, b) => a.ts - b.ts || a.decisionId.localeCompare(b.decisionId)).map(copy);
    },
    async recordTrade(t) { trades.set(key(t.decisionId, t.book), copy(t)); },
    async updateTradePosition(id, book, position) { const t = trades.get(key(id, book)); if (t && t.status === 'open') t.position = copy(position); },
    async openTrades(underlying, date) {
      return [...trades.values()].filter((t) => t.status === 'open' && decisions.get(t.decisionId)?.underlying === underlying && decisions.get(t.decisionId)?.tradeDate === date)
        .sort((a, b) => a.openedTs - b.openedTs || a.decisionId.localeCompare(b.decisionId) || a.book.localeCompare(b.book)).map(copy);
    },
    async recordOutcome(id, book, outcome: ClosedTrade) {
      if (outcomes.has(key(id, book))) throw new Error('UNIQUE: outcome already recorded');
      outcomes.set(key(id, book), copy({ decisionId: id, book, tradeDate: outcome.date, closedTs: outcome.closedTs, netPnl: outcome.netPnl, outcome }));
      const t = trades.get(key(id, book));
      if (t) t.status = 'closed';
    },
    async outcomesForDay(date) {
      return [...outcomes.values()].filter((o) => o.tradeDate === date).sort((a, b) => a.closedTs - b.closedTs || a.decisionId.localeCompare(b.decisionId) || a.book.localeCompare(b.book)).map(copy);
    },
  };
}
