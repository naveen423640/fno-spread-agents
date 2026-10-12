// The LLM reviewer. It never decides anything: it reads one closed trade (the frozen decision record, the outcome and the minute-by-minute path)
// and returns a structured review that is stored beside the trade. Output is validated against a schema; invalid output is retried once and then
// logged as a failure. No network is needed to test any of this (the client is injected).
import { z } from 'zod';
import { createLlmClient } from '@/lib/llm/client';
import { parseProviders } from '@/lib/llm/config';
import { createLimiter } from '@/lib/llm/limits';
import type { CallLogger, LlmClient, LlmMessage } from '@/lib/llm/types';
import { analyzeSession } from '@/lib/ltp/analyze';
import type { LtpStore } from '@/lib/ltp/store';
import { istHhmm } from '@/lib/ltp/time';
import type { DecisionRecord, JournalStore, OutcomeRow } from './journal-store';
import { MISTAKE_TAGS, OUTCOME_CLASSES, type MistakeTag, type OutcomeClass } from './taxonomy';

export const DEFAULT_REVIEW_MODEL = 'claude-sonnet-5-5';
const MAX_FAILED_ATTEMPTS = 3;
const limiter = createLimiter(() => Date.now());

const reviewSchema = z.object({
  outcome_class: z.enum(OUTCOME_CLASSES),
  mistake_tags: z.array(z.string()),
  what_happened: z.string().min(1),
  lesson: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type Review = { outcome_class: OutcomeClass; mistake_tags: MistakeTag[]; other_note?: string; what_happened: string; lesson: string; confidence: number };

export type PathPoint = {
  ts: number; time: string; spot: number; supportStrike: number; resistanceStrike: number; supportStatus: string; resistanceStatus: string;
  supportVolumePct: number | null; supportOiPct: number | null; resistanceVolumePct: number | null; resistanceOiPct: number | null; ceOiAtResistance: number | null; peOiAtSupport: number | null;
};
export type ReviewInput = { decision: DecisionRecord; outcomes: OutcomeRow[]; path: PathPoint[] };

// Anthropic only, the model from AGENT_REVIEW_MODEL or the default above. Null without ANTHROPIC_API_KEY: the journal then simply stays unreviewed.
export function buildReviewerLlm(env: Record<string, string | undefined>, log: CallLogger): (LlmClient & { model: string }) | null {
  const anthropic = parseProviders(env).find((p) => p.name === 'anthropic');
  if (!anthropic) return null;
  const model = env.AGENT_REVIEW_MODEL || DEFAULT_REVIEW_MODEL;
  return { ...createLlmClient({ providers: [{ ...anthropic, model }], limiter, log }), model };
}

const SYSTEM = `You review ONE closed paper trade of a rule-based options strategy (the LTP Calculator rules). The rules, not you, decide trades: you only classify what happened. The EOS and EOR levels are proxy estimates, not exact values.
Reply with ONLY a JSON object with these keys:
- outcome_class: one of ${OUTCOME_CLASSES.join(', ')} (good_trade_bad_result = rules followed, normal variance; bad_trade = a rule or data problem; lucky_win = won despite a problem)
- mistake_tags: an array chosen ONLY from this fixed list: ${MISTAKE_TAGS.join(', ')}. Use an empty array if none apply, and "other" if nothing fits.
- what_happened: two to four sentences, using only the data given.
- lesson: one sentence.
- confidence: a number from 0 to 1.
Do not invent facts that are not in the data.`;

const messagesFor = (input: ReviewInput): LlmMessage[] => [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(input) }];

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? body.slice(start, end + 1) : body);
}

function normalise(raw: z.infer<typeof reviewSchema>): Review {
  const known = raw.mistake_tags.filter((t): t is MistakeTag => (MISTAKE_TAGS as readonly string[]).includes(t));
  const unknown = raw.mistake_tags.filter((t) => !(MISTAKE_TAGS as readonly string[]).includes(t));
  return { outcome_class: raw.outcome_class, mistake_tags: unknown.length ? [...known, 'other'] : known, ...(unknown.length ? { other_note: `unrecognised tags: ${unknown.join(', ')}` } : {}), what_happened: raw.what_happened, lesson: raw.lesson, confidence: raw.confidence };
}

export async function reviewTrade(llm: LlmClient, input: ReviewInput, runId: string): Promise<{ ok: true; review: Review; model: string } | { ok: false; error: string }> {
  let problem = 'invalid output';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await llm.complete({ role: 'ltp-reviewer', runId, messages: messagesFor(input), maxTokens: 700 });
    if (!result.ok) return { ok: false, error: `llm: ${result.error} (${result.detail})` };
    try {
      const parsed = reviewSchema.safeParse(extractJson(result.text));
      if (parsed.success) return { ok: true, review: normalise(parsed.data), model: result.model };
      problem = `invalid output: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
    } catch { problem = 'invalid output: not JSON'; }
  }
  return { ok: false, error: problem };
}

// The minute-by-minute path from the decision to the last close: spot, levels, weakness and the OI at the walls, from the stored snapshots.
export async function buildReviewInput(deps: { store: LtpStore; journal: JournalStore }, decisionId: string): Promise<ReviewInput> {
  const decision = await deps.journal.decisionById(decisionId);
  if (!decision) throw new Error(`No decision ${decisionId}.`);
  const outcomes = await deps.journal.outcomesForDecision(decisionId);
  const closedTs = Math.max(decision.ts, ...outcomes.map((o) => o.closedTs));
  const snaps = await deps.store.snapshotsForDay(decision.underlying, decision.tradeDate);
  const path: PathPoint[] = [];
  for (const snap of snaps.filter((s) => s.ts >= decision.ts && s.ts <= closedTs)) {
    const a = analyzeSession(snaps.filter((s) => s.ts <= snap.ts), { now: snap.ts });
    if (a.empty || !a.usable) continue;
    path.push({
      ts: snap.ts, time: istHhmm(snap.ts), spot: snap.spot, supportStrike: a.levels.support.strike, resistanceStrike: a.levels.resistance.strike, supportStatus: a.strength.support.status, resistanceStatus: a.strength.resistance.status,
      supportVolumePct: a.strength.support.pct.volume, supportOiPct: a.strength.support.pct.oi, resistanceVolumePct: a.strength.resistance.pct.volume, resistanceOiPct: a.strength.resistance.pct.oi,
      ceOiAtResistance: a.series.ceOiAtResistance.at(-1)?.oi ?? null, peOiAtSupport: a.series.peOiAtSupport.at(-1)?.oi ?? null,
    });
  }
  return { decision, outcomes, path };
}

export type ReviewDayResult = { reviewed: number; failed: number; skipped?: 'no_api_key' };

export async function reviewDay(deps: { store: LtpStore; journal: JournalStore; llm: LlmClient | null; model: string }, date: string): Promise<ReviewDayResult> {
  if (!deps.llm) return { reviewed: 0, failed: 0, skipped: 'no_api_key' };
  let reviewed = 0;
  let failed = 0;
  const open = new Map<string, Set<string>>();
  for (const d of (await deps.journal.decisionsForDay(date)).filter((x) => x.taken)) {
    if (!open.has(d.underlying)) open.set(d.underlying, new Set((await deps.journal.openTrades(d.underlying, date)).map((t) => t.decisionId)));
    if (open.get(d.underlying)!.has(d.decisionId)) continue; // a book is still open: not a closed trade yet
    if ((await deps.journal.outcomesForDecision(d.decisionId)).length === 0 || (await deps.journal.reviewFor(d.decisionId)) !== null) continue;
    const key = `review_failed:${d.decisionId}`;
    const before = await deps.journal.getState(key);
    const attempts = before ? (JSON.parse(before) as { attempts: number }).attempts : 0;
    if (attempts >= MAX_FAILED_ATTEMPTS) continue;
    const result = await reviewTrade(deps.llm, await buildReviewInput(deps, d.decisionId), `review-${d.decisionId}`);
    if (result.ok) { await deps.journal.recordReview(d.decisionId, result.review, result.model); reviewed += 1; }
    else { await deps.journal.setState(key, JSON.stringify({ attempts: attempts + 1, error: result.error, at: Math.floor(Date.now() / 1000) })); failed += 1; }
  }
  return { reviewed, failed };
}

export type SummaryTrade = { decisionId: string; date: string; underlying: string; setup: string; scenario: number; hit: number; hhmm: string; buy: number | null; sell: number | null; review: Review | null };
type Group = { n: number; buyNet: number; sellNet: number };
type BookStats = { n: number; net: number; winRate: number; expectancy: number };
export type WeeklySummary = {
  trades: number; byTag: Record<string, number>; bySetup: Record<string, Group>; byScenario: Record<string, Group>; byHit: Record<string, Group>; byTimeBucket: Record<string, Group>; byUnderlying: Record<string, Group>;
  byBook: { buy: BookStats; sell: BookStats }; note: string;
};

const bucketOf = (hhmm: string) => (hhmm < '10:30' ? 'before 10:30' : hhmm < '12:00' ? '10:30 to 12:00' : hhmm < '14:00' ? '12:00 to 14:00' : 'after 14:00');

export function summarizeTrades(trades: SummaryTrade[]): WeeklySummary {
  const group = (key: (t: SummaryTrade) => string) => {
    const out: Record<string, Group> = {};
    for (const t of trades) { const g = (out[key(t)] ??= { n: 0, buyNet: 0, sellNet: 0 }); g.n += 1; g.buyNet += t.buy ?? 0; g.sellNet += t.sell ?? 0; }
    return out;
  };
  const book = (pick: (t: SummaryTrade) => number | null): BookStats => {
    const nets = trades.map(pick).filter((x): x is number => x !== null);
    const net = nets.reduce((a, b) => a + b, 0);
    return { n: nets.length, net, winRate: nets.length ? nets.filter((x) => x > 0).length / nets.length : 0, expectancy: nets.length ? net / nets.length : 0 };
  };
  const byTag: Record<string, number> = {};
  for (const t of trades) for (const tag of t.review?.mistake_tags ?? []) byTag[tag] = (byTag[tag] ?? 0) + 1;
  return {
    trades: trades.length, byTag, bySetup: group((t) => t.setup), byScenario: group((t) => String(t.scenario)), byHit: group((t) => String(t.hit)), byTimeBucket: group((t) => bucketOf(t.hhmm)), byUnderlying: group((t) => t.underlying),
    byBook: { buy: book((t) => t.buy), sell: book((t) => t.sell) }, note: 'Observations only. No rule changes are proposed in the journal phase.',
  };
}

export async function loadSummaryTrades(journal: JournalStore, days: string[]): Promise<SummaryTrade[]> {
  const out: SummaryTrade[] = [];
  for (const date of days) {
    const open = new Set<string>();
    for (const d of await journal.decisionsForDay(date)) {
      if (!d.taken) continue;
      const outcomes = await journal.outcomesForDecision(d.decisionId);
      if (!outcomes.length) continue;
      if (!open.size) for (const t of await journal.openTrades(d.underlying, date)) open.add(t.decisionId);
      if (open.has(d.decisionId)) continue;
      const net = (book: string) => outcomes.find((o) => o.book === book)?.netPnl ?? null;
      const c = d.context as { scenario?: number; hit?: number; hhmm?: string };
      out.push({ decisionId: d.decisionId, date, underlying: d.underlying, setup: d.setup, scenario: c.scenario ?? 0, hit: c.hit ?? 0, hhmm: c.hhmm ?? istHhmm(d.ts), buy: net('buy'), sell: net('sell'), review: (await journal.reviewFor(d.decisionId)) as Review | null });
    }
  }
  return out;
}
