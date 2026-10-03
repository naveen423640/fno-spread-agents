import type { CallLogEntry, CallLogger } from '../llm/types';
import type { AnalystReport, Source, Verdict } from './schemas';

export type RunStatus = 'running' | 'completed' | 'ai_unavailable' | 'failed';
export type StepStatus = 'ok' | 'failed' | 'unavailable';

export type NewRun = { id: string; symbol: string; asOf: string; tradingDate: string; candidate: unknown; promptSet: string };
export type NewStep = { runId: string; role: string; status: StepStatus; output?: unknown; error?: string };
export type RunRow = { id: string; symbol: string; asOf: string; tradingDate: string; status: RunStatus; candidate: unknown; promptSet: string; createdAt: string; completedAt: string | null };
export type StepRow = { role: string; status: StepStatus; output: unknown; error: string | null; startedAt: string };
export type CachedReport = { report: AnalystReport; sources: Source[] };
export type RunDetail = { run: RunRow; steps: StepRow[]; sources: Source[]; verdict: Verdict | null };

export type AgentStore = {
  createRun(run: NewRun): Promise<void>;
  setRunStatus(id: string, status: RunStatus, completedAt?: string): Promise<void>;
  saveStep(step: NewStep): Promise<void>;
  saveSources(runId: string, sources: Source[]): Promise<void>;
  saveVerdict(runId: string, verdict: Verdict): Promise<void>;
  getRun(id: string): Promise<RunDetail | null>;
  getCachedReport(symbol: string, tradingDate: string, role: string): Promise<CachedReport | null>;
  putCachedReport(symbol: string, tradingDate: string, role: string, cached: CachedReport): Promise<void>;
  logLlmCall: CallLogger;
};

type Bindable = string | number | null;
type D1Statement = {
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};
export type D1Like = { prepare(sql: string): D1Statement & { bind(...values: Bindable[]): D1Statement } };

const parse = (text: string | null) => (text === null ? null : (JSON.parse(text) as unknown));

// Tables come from drizzle/0002_agent_team.sql; this store never creates them.
export function createD1AgentStore(db: D1Like, now: () => Date = () => new Date()): AgentStore {
  const stamp = () => now().toISOString();
  return {
    async createRun(run) {
      await db.prepare('INSERT INTO agent_runs (id, symbol, as_of, trading_date, status, candidate_json, prompt_set, model_note, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(run.id, run.symbol, run.asOf, run.tradingDate, 'running', JSON.stringify(run.candidate), run.promptSet, '', stamp(), null).run();
    },
    async setRunStatus(id, status, completedAt) {
      await db.prepare('UPDATE agent_runs SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?').bind(status, completedAt ?? null, id).run();
    },
    async saveStep(step) {
      const at = stamp();
      await db.prepare('INSERT INTO agent_steps (run_id, role, status, output_json, error, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(step.runId, step.role, step.status, step.output === undefined ? null : JSON.stringify(step.output), step.error ?? null, at, at).run();
    },
    async saveSources(runId, sources) {
      for (const source of sources) {
        await db.prepare('INSERT OR REPLACE INTO agent_sources (id, run_id, kind, title, url, retrieved_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(source.id, runId, source.kind, source.title, source.url, source.retrieved_at).run();
      }
    },
    async saveVerdict(runId, verdict) {
      await db.prepare('INSERT OR REPLACE INTO verdicts (run_id, verdict, reduce_to_lots, delay_to, body_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(runId, verdict.verdict, verdict.reduce_to_lots ?? null, verdict.delay_to ?? null, JSON.stringify(verdict), stamp()).run();
    },
    async getRun(id) {
      const row = await db.prepare('SELECT * FROM agent_runs WHERE id = ?').bind(id).first<Record<string, string | null>>();
      if (!row) return null;
      const steps = await db.prepare('SELECT role, status, output_json, error, started_at FROM agent_steps WHERE run_id = ? ORDER BY id').bind(id).all<Record<string, string | null>>();
      const sources = await db.prepare('SELECT id, kind, title, url, retrieved_at FROM agent_sources WHERE run_id = ? ORDER BY rowid').bind(id).all<Source>();
      const verdict = await db.prepare('SELECT body_json FROM verdicts WHERE run_id = ?').bind(id).first<{ body_json: string }>();
      return {
        run: { id: row.id as string, symbol: row.symbol as string, asOf: row.as_of as string, tradingDate: row.trading_date as string, status: row.status as RunStatus, candidate: parse(row.candidate_json), promptSet: row.prompt_set as string, createdAt: row.created_at as string, completedAt: row.completed_at },
        steps: steps.results.map((step) => ({ role: step.role as string, status: step.status as StepStatus, output: parse(step.output_json), error: step.error, startedAt: step.started_at as string })),
        sources: sources.results,
        verdict: verdict ? (parse(verdict.body_json) as Verdict) : null,
      };
    },
    async getCachedReport(symbol, tradingDate, role) {
      const row = await db.prepare('SELECT report_json FROM analyst_report_cache WHERE symbol = ? AND trading_date = ? AND role = ?').bind(symbol, tradingDate, role).first<{ report_json: string }>();
      return row ? (parse(row.report_json) as CachedReport) : null;
    },
    async putCachedReport(symbol, tradingDate, role, cached) {
      await db.prepare('INSERT INTO analyst_report_cache (symbol, trading_date, role, report_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(symbol, trading_date, role) DO UPDATE SET report_json = excluded.report_json, created_at = excluded.created_at')
        .bind(symbol, tradingDate, role, JSON.stringify(cached), stamp()).run();
    },
    async logLlmCall(entry: CallLogEntry) {
      await db.prepare('INSERT INTO llm_calls (run_id, role, provider, model, prompt_hash, tokens_in, tokens_out, cost_inr, latency_ms, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(entry.runId, entry.role, entry.provider, entry.model, entry.promptHash, entry.tokensIn, entry.tokensOut, entry.costInr, entry.latencyMs, entry.status, stamp()).run();
    },
  };
}

export function createMemoryAgentStore(now: () => Date = () => new Date()): AgentStore & { llmCalls: CallLogEntry[] } {
  const runs = new Map<string, RunRow>();
  const steps = new Map<string, StepRow[]>();
  const sources = new Map<string, Source[]>();
  const verdicts = new Map<string, Verdict>();
  const cache = new Map<string, CachedReport>();
  const llmCalls: CallLogEntry[] = [];
  const stamp = () => now().toISOString();
  return {
    llmCalls,
    async createRun(run) {
      runs.set(run.id, { id: run.id, symbol: run.symbol, asOf: run.asOf, tradingDate: run.tradingDate, status: 'running', candidate: run.candidate, promptSet: run.promptSet, createdAt: stamp(), completedAt: null });
    },
    async setRunStatus(id, status, completedAt) {
      const run = runs.get(id);
      if (run) runs.set(id, { ...run, status, completedAt: completedAt ?? run.completedAt });
    },
    async saveStep(step) {
      const list = steps.get(step.runId) ?? [];
      list.push({ role: step.role, status: step.status, output: step.output ?? null, error: step.error ?? null, startedAt: stamp() });
      steps.set(step.runId, list);
    },
    async saveSources(runId, items) {
      const merged = new Map((sources.get(runId) ?? []).map((item) => [item.id, item]));
      for (const item of items) merged.set(item.id, item);
      sources.set(runId, [...merged.values()]);
    },
    async saveVerdict(runId, verdict) { verdicts.set(runId, verdict); },
    async getRun(id) {
      const run = runs.get(id);
      if (!run) return null;
      return { run, steps: steps.get(id) ?? [], sources: sources.get(id) ?? [], verdict: verdicts.get(id) ?? null };
    },
    async getCachedReport(symbol, tradingDate, role) { return cache.get(`${symbol}|${tradingDate}|${role}`) ?? null; },
    async putCachedReport(symbol, tradingDate, role, cached) { cache.set(`${symbol}|${tradingDate}|${role}`, cached); },
    async logLlmCall(entry) { llmCalls.push(entry); },
  };
}
