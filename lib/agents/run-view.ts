import type { ANALYST_ROLES, Source, Verdict } from './schemas';
import type { RunDetail } from './store';

export type RunResponse = RunDetail;
export type Phase = 'starting' | 'analysts' | 'debate' | 'risk' | 'done' | 'unavailable' | 'failed';
export type AnalystCard = { role: (typeof ANALYST_ROLES)[number]; status: 'pending' | 'ok' | 'failed' | 'unavailable'; summary?: string; reason?: string };
export type RunView = {
  phase: Phase;
  analystCards: AnalystCard[];
  debate: { role: string; text: string }[];
  proposal: string | null;
  verdict: Verdict | null;
  sources: Source[];
  reason: string | null;
};

const ROLES: AnalystCard['role'][] = ['technical', 'options_oi', 'news', 'fundamentals'];
const textOf = (output: unknown) => (output && typeof output === 'object' && 'text' in output && typeof output.text === 'string' ? output.text : '');
const summaryOf = (output: unknown) => (output && typeof output === 'object' && 'summary' in output && typeof output.summary === 'string' ? output.summary : undefined);

export function summarizeRun(data: RunResponse | null): RunView {
  if (!data) return { phase: 'starting', analystCards: ROLES.map((role) => ({ role, status: 'pending' })), debate: [], proposal: null, verdict: null, sources: [], reason: null };

  const { run, steps } = data;
  const analystCards: AnalystCard[] = ROLES.map((role) => {
    const found = steps.find((step) => step.role === role);
    if (!found) return { role, status: 'pending' };
    return { role, status: found.status, summary: found.status === 'ok' ? summaryOf(found.output) : undefined, reason: found.error ?? undefined };
  });
  const debate = steps.filter((step) => step.role === 'bull' || step.role === 'bear').map((step) => ({ role: step.role, text: textOf(step.output) }));
  const trader = steps.find((step) => step.role === 'trader');
  const runStep = steps.find((step) => step.role === 'run');

  let phase: Phase;
  if (run.status === 'completed') phase = 'done';
  else if (run.status === 'ai_unavailable') phase = 'unavailable';
  else if (run.status === 'failed') phase = 'failed';
  else if (trader) phase = 'risk';
  else if (analystCards.some((card) => card.status !== 'pending')) phase = 'debate';
  else phase = 'analysts';

  return { phase, analystCards, debate, proposal: trader ? textOf(trader.output) || null : null, verdict: data.verdict, sources: data.sources, reason: runStep?.error ?? null };
}
