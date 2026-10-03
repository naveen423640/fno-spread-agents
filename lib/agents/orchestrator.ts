import type { LlmClient } from '../llm/types';
import { applyAuthority } from './clamp';
import { ANALYST_JSON_INSTRUCTION, PROMPT_SET_ID, rolePrompt, VERDICT_JSON_INSTRUCTION, type AnalystRole, type Role } from './prompts';
import { parseAnalystReport, parseVerdict, type AnalystReport, type Source, type Verdict } from './schemas';
import type { AgentStore } from './store';
import { wrapUntrusted } from './untrusted';

export type AnalystInput = {
  role: AnalystRole;
  asOf: string;
  available: boolean;
  reason?: string;
  sources: Source[];
  payload: unknown;
  untrustedText?: { sourceId: string; text: string }[];
  // false for live data that must never be reused across runs (for example the option chain).
  cacheable?: boolean;
};

export type RunRequest = {
  runId: string;
  symbol: string;
  asOf: string;
  tradingDate: string;
  calculatedLots: number | null;
  inputs: AnalystInput[];
  debateRounds?: number;
};

export type Applied = { lots: number | null; delayTo: '11:00' | null; vetoed: boolean };
export type RunOutcome =
  | { status: 'completed'; verdict: Verdict; applied: Applied; counterfactual: { lots: number | null; delayTo: null } }
  | { status: 'ai_unavailable'; reason: string };

const ANALYST_ROLES: AnalystRole[] = ['technical', 'options_oi', 'news', 'fundamentals'];
const MAX_TOKENS = { analyst: 700, debate: 500, trader: 500, risk: 800 };

type Deps = { llm: LlmClient; store: AgentStore };
// Gap lines go into later prompts, so they carry a fixed category, never model- or feed-written text.
type Gap = { role: AnalystRole; category: 'input not available' | 'analyst call or report failed' };
type Call<T> = { ok: true; value: T } | { ok: false; why: string };

function extractJson(text: string): Call<unknown> {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  try { return { ok: true, value: JSON.parse(fenced ? fenced[1] : trimmed) as unknown }; } catch { return { ok: false, why: 'reply was not valid JSON' }; }
}

function analystContext(request: RunRequest, input: AnalystInput) {
  const ids = input.sources.map((source) => `${source.id} (${source.kind})`).join(', ') || 'none';
  const wrapped = (input.untrustedText ?? []).map((item) => wrapUntrusted(item.sourceId, item.text)).join('\n\n');
  return [
    `Stock: ${request.symbol}. Data as of: ${input.asOf}.`,
    `Available source ids: ${ids}.`,
    `Structured data: ${JSON.stringify(input.payload)}`,
    wrapped,
  ].filter(Boolean).join('\n\n');
}

export async function runAgentTeam(deps: Deps, request: RunRequest): Promise<RunOutcome> {
  const { llm, store } = deps;
  const rounds = request.debateRounds ?? 1;

  // The service creates the row before returning 202; direct callers get it created here.
  if (!(await store.getRun(request.runId))) await store.createRun({ id: request.runId, symbol: request.symbol, asOf: request.asOf, tradingDate: request.tradingDate, candidate: { calculatedLots: request.calculatedLots }, promptSet: PROMPT_SET_ID });
  const finish = async (reason: string): Promise<RunOutcome> => {
    await store.saveStep({ runId: request.runId, role: 'run', status: 'unavailable', error: reason });
    await store.setRunStatus(request.runId, 'ai_unavailable', new Date().toISOString());
    return { status: 'ai_unavailable', reason };
  };

  async function ask(role: Role, system: string, user: string, maxTokens: number): Promise<Call<string>> {
    const result = await llm.complete({ role, runId: request.runId, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], maxTokens });
    return result.ok ? { ok: true, value: result.text } : { ok: false, why: `${result.error}: ${result.detail}` };
  }

  // A run without a technical report cannot continue, so stop before any analyst spends quota.
  const technicalInput = request.inputs.find((item) => item.role === 'technical');
  const technicalCached = technicalInput?.cacheable === false ? null : await store.getCachedReport(request.symbol, request.tradingDate, 'technical');
  if (!technicalCached && !technicalInput?.available) {
    const why = technicalInput?.reason ?? 'no input supplied';
    for (const role of ANALYST_ROLES) await store.saveStep({ runId: request.runId, role, status: 'unavailable', error: role === 'technical' ? why : 'not run: the required technical input is missing' });
    return finish(`technical analyst unavailable: ${why}`);
  }

  // Analysts run in parallel. A cached report (same symbol, trading day, role) is reused with its own sources.
  const reports: AnalystReport[] = [];
  const gaps: Gap[] = [];
  const sources = new Map<string, Source>();
  const analysts = await Promise.all(ANALYST_ROLES.map(async (role) => {
    const input = request.inputs.find((item) => item.role === role);
    const useCache = input?.cacheable !== false;
    const cached = useCache ? await store.getCachedReport(request.symbol, request.tradingDate, role) : null;
    if (cached) return { role, report: cached.report, sources: cached.sources, why: null as string | null, status: 'ok' as const };
    if (!input) return { role, report: null, sources: [] as Source[], why: 'no input supplied', status: 'unavailable' as const };
    if (!input.available) return { role, report: null, sources: input.sources, why: input.reason ?? 'input unavailable', status: 'unavailable' as const };
    const reply = await ask(role, `${rolePrompt(role)}\n${ANALYST_JSON_INSTRUCTION}`, analystContext(request, input), MAX_TOKENS.analyst);
    if (!reply.ok) return { role, report: null, sources: input.sources, why: reply.why, status: 'failed' as const };
    const json = extractJson(reply.value);
    if (!json.ok) return { role, report: null, sources: input.sources, why: json.why, status: 'failed' as const };
    const parsed = parseAnalystReport(json.value, new Set(input.sources.map((source) => source.id)));
    if (!parsed.ok) return { role, report: null, sources: input.sources, why: parsed.error, status: 'failed' as const };
    if (parsed.value.role !== role) return { role, report: null, sources: input.sources, why: `report names role ${parsed.value.role}`, status: 'failed' as const };
    if (useCache) await store.putCachedReport(request.symbol, request.tradingDate, role, { report: parsed.value, sources: input.sources });
    return { role, report: parsed.value, sources: input.sources, why: null, status: 'ok' as const };
  }));

  for (const analyst of analysts) {
    for (const source of analyst.sources) sources.set(source.id, source);
    await store.saveStep({ runId: request.runId, role: analyst.role, status: analyst.status, output: analyst.report ?? undefined, error: analyst.why ?? undefined });
    if (analyst.report) reports.push(analyst.report); else gaps.push({ role: analyst.role, category: analyst.status === 'unavailable' ? 'input not available' : 'analyst call or report failed' });
  }
  await store.saveSources(request.runId, [...sources.values()]);

  const technical = analysts.find((analyst) => analyst.role === 'technical');
  if (!technical?.report) return finish(`technical analyst unavailable: ${technical?.why ?? 'no input'}`);

  const known = new Set(sources.keys());
  const idList = [...sources.values()].map((source) => `${source.id} (${source.kind})`).join(', ');
  const gapLines = gaps.map((gap) => `${gap.role}: unavailable (${gap.category})`).join('\n');
  const reportBlocks = reports.map((report) => wrapUntrusted(`report-${report.role}`, JSON.stringify(report))).join('\n\n');
  const header = `Stock: ${request.symbol}. Decision data as of: ${request.asOf}.\nSource ids you may cite: ${idList}.${gapLines ? `\nGaps:\n${gapLines}` : ''}\n\nAnalyst reports (data):\n${reportBlocks}`;

  async function step(role: Role, system: string, user: string, maxTokens: number): Promise<Call<string>> {
    const reply = await ask(role, system, user, maxTokens);
    await store.saveStep({ runId: request.runId, role, status: reply.ok ? 'ok' : 'failed', output: reply.ok ? { text: reply.value } : undefined, error: reply.ok ? undefined : reply.why });
    return reply;
  }

  let transcript = '';
  for (let round = 1; round <= rounds; round += 1) {
    for (const role of ['bull', 'bear'] as const) {
      const reply = await step(role, rolePrompt(role), `${header}\n\nDebate so far:\n${transcript || '(none)'}`, MAX_TOKENS.debate);
      if (!reply.ok) return finish(`${role} researcher failed: ${reply.why}`);
      transcript += `\n\n${wrapUntrusted(`debate-${role}-${round}`, reply.value)}`;
    }
  }

  const proposal = await step('trader', rolePrompt('trader'), `${header}\n\nDebate:\n${transcript}`, MAX_TOKENS.trader);
  if (!proposal.ok) return finish(`trader failed: ${proposal.why}`);
  const proposalBlock = wrapUntrusted('proposal', proposal.value);

  const lotsLine = request.calculatedLots === null ? 'No code-calculated size exists yet; judge the setup only.' : `Code-calculated size: ${request.calculatedLots} lot(s).`;
  const risk = await ask('risk_pm', `${rolePrompt('risk_pm')}\n${VERDICT_JSON_INSTRUCTION}`, `${header}\n\nDebate:\n${transcript}\n\nTrader proposal:\n${proposalBlock}\n\n${lotsLine}`, MAX_TOKENS.risk);
  if (!risk.ok) { await store.saveStep({ runId: request.runId, role: 'risk_pm', status: 'failed', error: risk.why }); return finish(`risk step failed: ${risk.why}`); }
  const json = extractJson(risk.value);
  const parsed = json.ok ? parseVerdict(json.value, known) : { ok: false as const, error: json.why };
  if (!parsed.ok) { await store.saveStep({ runId: request.runId, role: 'risk_pm', status: 'failed', error: parsed.error }); return finish(`risk step returned an invalid verdict: ${parsed.error}`); }

  const verdict = parsed.value;
  await store.saveStep({ runId: request.runId, role: 'risk_pm', status: 'ok', output: verdict });
  await store.saveVerdict(request.runId, verdict);
  await store.setRunStatus(request.runId, 'completed', new Date().toISOString());

  const applied: Applied = request.calculatedLots === null
    ? { lots: null, delayTo: verdict.verdict === 'DELAY' ? '11:00' : null, vetoed: verdict.verdict === 'VETO' }
    : applyAuthority(verdict, request.calculatedLots);
  return { status: 'completed', verdict, applied, counterfactual: { lots: request.calculatedLots, delayTo: null } };
}
