import type { ANALYST_ROLES, Source, Verdict } from './schemas';
import type { RunDetail, VerdictOutcome } from './store';

export type RunResponse = RunDetail;
export type Phase = 'starting' | 'analysts' | 'debate' | 'risk' | 'done' | 'unavailable' | 'failed';
export type AnalystCard = { role: (typeof ANALYST_ROLES)[number]; status: 'pending' | 'ok' | 'failed' | 'unavailable'; summary?: string; reason?: string };
export type RunView = {
  phase: Phase;
  analystCards: AnalystCard[];
  debate: { role: string; text: string }[];
  proposal: string | null;
  verdict: Verdict | null;
  outcome: VerdictOutcome | null;
  sources: Source[];
  reason: string | null;
};

const ROLES: AnalystCard['role'][] = ['technical', 'options_oi', 'news', 'fundamentals'];
const textOf = (output: unknown) => (output && typeof output === 'object' && 'text' in output && typeof output.text === 'string' ? output.text : '');
const summaryOf = (output: unknown) => (output && typeof output === 'object' && 'summary' in output && typeof output.summary === 'string' ? output.summary : undefined);

export function summarizeRun(data: RunResponse | null): RunView {
  if (!data) return { phase: 'starting', analystCards: ROLES.map((role) => ({ role, status: 'pending' })), debate: [], proposal: null, verdict: null, outcome: null, sources: [], reason: null };

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

  return { phase, analystCards, debate, proposal: trader ? textOf(trader.output) || null : null, verdict: data.verdict, outcome: data.outcome, sources: data.sources, reason: runStep?.error ?? null };
}

// Shows what the code applies after the authority clamp; the model's own request is only mentioned.
export function describeVerdict(verdict: Verdict, outcome: VerdictOutcome | null): string {
  const lots = outcome?.applied.lots ?? null;
  switch (verdict.verdict) {
    case 'VETO':
      return 'VETO: no trade';
    case 'DELAY':
      return `DELAY: enter at ${verdict.delay_to ?? '11:00'}${lots === null ? '' : ` with ${lots} lot(s)`}`;
    case 'REDUCE': {
      const asked = verdict.reduce_to_lots;
      if (lots === null) return `REDUCE: requested ${asked} lot(s); no calculated size to apply it to`;
      return `REDUCE to ${lots} lot(s)${asked !== undefined && asked !== lots ? ` (model asked for ${asked})` : ''}`;
    }
    default:
      return lots === null ? 'APPROVE' : `APPROVE: ${lots} lot(s)`;
  }
}
