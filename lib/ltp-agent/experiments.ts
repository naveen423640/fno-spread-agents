// Proposals: after 100 closed trades the LLM may suggest at most 3 experiments per run, each a diff over the tunable fields only. It is shown
// the discovery set and nothing else (no holdout trades, reviews or gate results). Every kept proposal becomes a permanent EXP-### record.
import { z } from 'zod';
import type { LlmClient } from '@/lib/llm/types';
import type { Experiment } from './experiment-types';
import { discoverySet, type Split } from './holdout';
import type { JournalStore } from './journal-store';
import { assertLearning } from './phase';
import { extractJson } from './reviewer';
import { getPath, TUNABLE_FIELDS, validateDiff, type Strategy } from './strategy';

const MAX_PROPOSALS = 3;
const proposalSchema = z.object({ experiments: z.array(z.object({ hypothesis: z.string().min(1), diff: z.record(z.string(), z.unknown()), expected_effect: z.string().min(1), evidence: z.array(z.string()) })) });
export type Proposal = z.infer<typeof proposalSchema>['experiments'][number];

export const experimentFileName = (id: string) => `${id}.json`;
export const serializeExperiment = (e: Experiment) => `${JSON.stringify(e, null, 1)}\n`;
export const nextExperimentId = (existing: { id: string }[]) => `EXP-${String(Math.max(0, ...existing.map((e) => Number(e.id.replace('EXP-', '')) || 0)) + 1).padStart(3, '0')}`;

export function parseProposals(text: string): Proposal[] {
  return proposalSchema.parse(extractJson(text)).experiments;
}

const SYSTEM = `You propose changes to the rules of a paper-trading strategy for the LTP Calculator method. You are shown the strategy, a summary of past trades and reviews, and earlier experiments (without their results).
You may change ONLY these fields, within these bounds: ${JSON.stringify(TUNABLE_FIELDS)}.
Every proposal is tested on days you cannot see, and most changes will not help; proposing nothing is a valid answer.
Reply with ONLY a JSON object: {"experiments":[{"hypothesis":"...","diff":{"<field>":<value>},"expected_effect":"...","evidence":["tag or decision id from the data", ...]}]} with at most ${MAX_PROPOSALS} experiments. The diff keys must be exactly the field paths above. Do not invent evidence.`;

export type ProposeResult = { experiments: Experiment[]; dropped: { reason: string; proposal: unknown }[]; failure?: string };

export async function proposeExperiments(deps: { llm: LlmClient; journal: JournalStore }, current: Strategy, split: Split): Promise<ProposeResult> {
  const { llm, journal } = deps;
  await assertLearning(journal, current.version);
  const discovery = await discoverySet(journal, current.version, split);
  const existing = await journal.listExperiments();
  const user = JSON.stringify({
    strategy: Object.fromEntries(Object.keys(TUNABLE_FIELDS).map((k) => [k, getPath(current, k)])),
    summary: discovery.summary,
    reviews: discovery.trades.filter((t) => t.review).slice(-30).map((t) => ({ decisionId: t.decisionId, tags: t.review!.mistake_tags, what_happened: t.review!.what_happened, lesson: t.review!.lesson })),
    earlierExperiments: existing.map((e) => ({ id: e.id, hypothesis: e.hypothesis, diff: e.diff, status: e.status })),
  });
  let proposals: Proposal[] | null = null;
  let problem = 'invalid output';
  for (let attempt = 0; attempt < 2 && !proposals; attempt += 1) {
    const result = await llm.complete({ role: 'ltp-proposer', runId: `propose-${Date.now()}`, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], maxTokens: 1500 });
    if (!result.ok) return { experiments: [], dropped: [], failure: `llm: ${result.error} (${result.detail})` };
    try { proposals = parseProposals(result.text); } catch { problem = 'invalid output: not the expected JSON'; }
  }
  if (!proposals) return { experiments: [], dropped: [], failure: problem };

  const kept: Experiment[] = [];
  const dropped: ProposeResult['dropped'] = [];
  for (const [i, p] of proposals.entries()) {
    if (i >= MAX_PROPOSALS) { dropped.push({ reason: `more than ${MAX_PROPOSALS} proposals: this one was dropped`, proposal: p }); continue; }
    const check = validateDiff(p.diff);
    if (!check.ok) { dropped.push({ reason: check.reason, proposal: p }); continue; }
    if (Object.entries(p.diff).every(([k, v]) => getPath(current, k) === v)) { dropped.push({ reason: 'no change: every field already has that value', proposal: p }); continue; }
    const experiment: Experiment = {
      id: nextExperimentId([...existing, ...kept]), hypothesis: p.hypothesis, diff: p.diff, expectedEffect: p.expected_effect, evidence: p.evidence, baseVersion: current.version, split,
      status: 'proposed', triedCount: existing.length + kept.length + 1, createdTs: Math.floor(Date.now() / 1000),
    };
    await journal.saveExperiment(experiment);
    kept.push(experiment);
  }
  return { experiments: kept, dropped };
}
