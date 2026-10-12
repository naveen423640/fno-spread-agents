// D1 storage for the LTP agent journal (tables from drizzle/0010_ltp_agent.sql). Decisions are insert-only, and the database enforces it with
// triggers; outcomes and reviews are separate tables linked by decision_id, so nothing learned afterwards can change the recorded "why".
import type { D1Like } from '@/lib/agents/store';
import type { Book, ClosedTrade } from './books';
import type { Experiment } from './experiment-types';
import type { RuleStep, SetupType } from './signals';

type Raw = Record<string, string | number | null>;
type Json = Record<string, unknown>;

export type DecisionRecord = {
  decisionId: string; ts: number; tradeDate: string; underlying: string; strategyVersion: string; setup: SetupType; direction: 'long' | 'short'; book: 'both';
  taken: boolean; skipReason: string | null;
  context: Json; trace: RuleStep[]; reason: string; expectation: Json; dataQuality: Json;
};
export type TradeRow = { decisionId: string; book: Book; status: 'open' | 'closed'; openedTs: number; position: unknown };
export type OutcomeRow = { decisionId: string; book: Book; tradeDate: string; closedTs: number; netPnl: number; outcome: ClosedTrade };

export type ClosedRecord = { decision: DecisionRecord; outcomes: OutcomeRow[]; review: unknown };
export type ClosedFilter = { version?: string; from?: string; to?: string; excludeDays?: string[] };

export type JournalStore = ReturnType<typeof createJournalStore>;

const parse = <T>(text: string | number | null) => JSON.parse(text as string) as T;

export function createJournalStore(db: D1Like) {
  const all = async (sql: string, ...bind: (string | number)[]) => (await db.prepare(sql).bind(...bind).all<Raw>()).results;
  const first = async (sql: string, ...bind: (string | number)[]) => db.prepare(sql).bind(...bind).first<Raw>();
  const toDecision = (r: Raw): DecisionRecord => ({
    decisionId: r.decision_id as string, ts: r.ts as number, tradeDate: r.trade_date as string, underlying: r.underlying as string, strategyVersion: r.strategy_version as string,
    setup: r.setup as SetupType, direction: r.direction as 'long' | 'short', book: 'both', taken: r.taken === 1, skipReason: (r.skip_reason as string | null) ?? null,
    context: parse(r.context_json), trace: parse(r.trace_json), reason: r.reason as string, expectation: parse(r.expectation_json), dataQuality: parse(r.data_quality_json),
  });
  return {
    async recordDecision(d: DecisionRecord) {
      await db.prepare('INSERT INTO agent_decisions (decision_id, ts, trade_date, underlying, strategy_version, setup, direction, book, taken, skip_reason, context_json, trace_json, reason, expectation_json, data_quality_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(d.decisionId, d.ts, d.tradeDate, d.underlying, d.strategyVersion, d.setup, d.direction, d.book, d.taken ? 1 : 0, d.skipReason, JSON.stringify(d.context), JSON.stringify(d.trace), d.reason, JSON.stringify(d.expectation), JSON.stringify(d.dataQuality)).run();
    },
    async decisionById(id: string) {
      const r = await first('SELECT * FROM agent_decisions WHERE decision_id = ?', id);
      return r ? toDecision(r) : null;
    },
    async decisionsForDay(date: string, underlying?: string) {
      const rows = underlying
        ? await all('SELECT * FROM agent_decisions WHERE trade_date = ? AND underlying = ? ORDER BY ts, decision_id', date, underlying)
        : await all('SELECT * FROM agent_decisions WHERE trade_date = ? ORDER BY ts, decision_id', date);
      return rows.map(toDecision);
    },
    async recordTrade(t: TradeRow) {
      await db.prepare('INSERT INTO agent_trades (decision_id, book, status, opened_ts, position_json) VALUES (?, ?, ?, ?, ?)').bind(t.decisionId, t.book, t.status, t.openedTs, JSON.stringify(t.position)).run();
    },
    async updateTradePosition(decisionId: string, book: Book, position: unknown) {
      await db.prepare("UPDATE agent_trades SET position_json = ? WHERE decision_id = ? AND book = ? AND status = 'open'").bind(JSON.stringify(position), decisionId, book).run();
    },
    async openTrades(underlying: string, date: string): Promise<TradeRow[]> {
      const rows = await all("SELECT t.* FROM agent_trades t JOIN agent_decisions d ON d.decision_id = t.decision_id WHERE d.underlying = ? AND d.trade_date = ? AND t.status = 'open' ORDER BY t.opened_ts, t.decision_id, t.book", underlying, date);
      return rows.map((r) => ({ decisionId: r.decision_id as string, book: r.book as Book, status: 'open', openedTs: r.opened_ts as number, position: parse(r.position_json) }));
    },
    async recordOutcome(decisionId: string, book: Book, outcome: ClosedTrade) {
      await db.prepare('INSERT INTO trade_outcomes (decision_id, book, trade_date, closed_ts, net_pnl, outcome_json) VALUES (?, ?, ?, ?, ?, ?)').bind(decisionId, book, outcome.date, outcome.closedTs, outcome.netPnl, JSON.stringify(outcome)).run();
      await db.prepare("UPDATE agent_trades SET status = 'closed' WHERE decision_id = ? AND book = ?").bind(decisionId, book).run();
    },
    async outcomesForDecision(decisionId: string): Promise<OutcomeRow[]> {
      const rows = await all('SELECT * FROM trade_outcomes WHERE decision_id = ? ORDER BY book', decisionId);
      return rows.map((r) => ({ decisionId: r.decision_id as string, book: r.book as Book, tradeDate: r.trade_date as string, closedTs: r.closed_ts as number, netPnl: r.net_pnl as number, outcome: parse<ClosedTrade>(r.outcome_json) }));
    },
    async outcomesForDay(date: string): Promise<OutcomeRow[]> {
      const rows = await all('SELECT * FROM trade_outcomes WHERE trade_date = ? ORDER BY closed_ts, decision_id, book', date);
      return rows.map((r) => ({ decisionId: r.decision_id as string, book: r.book as Book, tradeDate: r.trade_date as string, closedTs: r.closed_ts as number, netPnl: r.net_pnl as number, outcome: parse<ClosedTrade>(r.outcome_json) }));
    },
    async saveStrategy(version: string, yaml: string, changelog: string) {
      await db.prepare('INSERT INTO agent_strategies (version, yaml, changelog, created_ts) VALUES (?, ?, ?, ?)').bind(version, yaml, changelog, Math.floor(Date.now() / 1000)).run();
    },
    async strategyYaml(version: string) {
      return ((await first('SELECT yaml FROM agent_strategies WHERE version = ?', version))?.yaml as string | undefined) ?? null;
    },
    // A closed trade: a taken decision that has at least one booked trade and no trade still open.
    async closedTradeCount(version: string) {
      const r = await first("SELECT COUNT(*) AS n FROM agent_decisions d WHERE d.strategy_version = ? AND d.taken = 1 AND EXISTS (SELECT 1 FROM agent_trades t WHERE t.decision_id = d.decision_id) AND NOT EXISTS (SELECT 1 FROM agent_trades t WHERE t.decision_id = d.decision_id AND t.status <> 'closed')", version);
      return (r?.n as number) ?? 0;
    },
    // Closed trades (a taken decision with at least one booked trade and none open), newest last. The filters run in the query: `excludeDays` is how
    // holdout days are kept away from the reviewer and the proposer.
    async closedTrades(filter: ClosedFilter = {}): Promise<ClosedRecord[]> {
      const where: string[] = ["d.taken = 1", "EXISTS (SELECT 1 FROM agent_trades t WHERE t.decision_id = d.decision_id)", "NOT EXISTS (SELECT 1 FROM agent_trades t WHERE t.decision_id = d.decision_id AND t.status <> 'closed')"];
      const bind: (string | number)[] = [];
      if (filter.version) { where.push('d.strategy_version = ?'); bind.push(filter.version); }
      if (filter.from) { where.push('d.trade_date >= ?'); bind.push(filter.from); }
      if (filter.to) { where.push('d.trade_date <= ?'); bind.push(filter.to); }
      if (filter.excludeDays?.length) { where.push(`d.trade_date NOT IN (${filter.excludeDays.map(() => '?').join(', ')})`); bind.push(...filter.excludeDays); }
      const rows = await all(`SELECT d.* FROM agent_decisions d WHERE ${where.join(' AND ')} ORDER BY d.ts, d.decision_id`, ...bind);
      const out: ClosedRecord[] = [];
      for (const r of rows) {
        const decision = toDecision(r);
        out.push({ decision, outcomes: await this.outcomesForDecision(decision.decisionId), review: await this.reviewFor(decision.decisionId) });
      }
      return out;
    },
    async recordReview(decisionId: string, review: unknown, model: string) {
      await db.prepare('INSERT INTO trade_reviews (decision_id, model, review_json, created_ts) VALUES (?, ?, ?, ?)').bind(decisionId, model, JSON.stringify(review), Math.floor(Date.now() / 1000)).run();
    },
    async reviewFor(decisionId: string) {
      const r = await first('SELECT review_json FROM trade_reviews WHERE decision_id = ?', decisionId);
      return r ? parse<unknown>(r.review_json) : null;
    },
    // Experiments are kept for good: there is deliberately no way to remove one.
    async saveExperiment(e: Experiment) {
      await db.prepare('INSERT INTO agent_experiments (id, status, json, created_ts) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, json = excluded.json').bind(e.id, e.status, JSON.stringify(e), e.createdTs).run();
    },
    async getExperiment(id: string) {
      const r = await first('SELECT json FROM agent_experiments WHERE id = ?', id);
      return r ? parse<Experiment>(r.json) : null;
    },
    async listExperiments() {
      return (await all('SELECT json FROM agent_experiments ORDER BY id')).map((r) => parse<Experiment>(r.json));
    },
    async getState(key: string) {
      const r = await first('SELECT value FROM agent_state WHERE key = ?', key);
      return (r?.value as string | undefined) ?? null;
    },
    async setState(key: string, value: string) {
      await db.prepare('INSERT INTO agent_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
    },
  };
}
