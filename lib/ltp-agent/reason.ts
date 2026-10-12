// The short "why" of a candidate (see reasonText).
import type { UsableAnalysis } from '@/lib/ltp/analyze';
import { signalTag } from '@/lib/ltp/tug-of-war';
import type { Candidate, RuleStep } from './signals';

const NAMES: Record<string, string> = { 'NSE:NIFTY50-INDEX': 'NIFTY', 'NSE:NIFTYBANK-INDEX': 'BANKNIFTY', 'BSE:SENSEX-INDEX': 'SENSEX' };
const fmt = (x: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(x);

// A few words for the rule that stopped a signal.
function why(step: RuleStep): string {
  const i = step.inputs;
  switch (step.rule) {
    case 'scenario_allowed': return i.graph_consistent === false ? 'graph mismatch' : 'no level for this side';
    case 'time_window': return `${i.time} outside ${i.start}-${i.end}`;
    case 'valid_plan': return 'no usable SL/target';
    case 'hit_number': return `hit #${i.hit} over max ${i.max}`;
    case 'coa2_agree': return 'COA2 must agree';
    case 'soc_opposes': return `opposing SOC ${i.soc}`;
    case 'daily_trade_cap': return 'daily trade cap';
    case 'max_concurrent': return 'trade already open';
    case 'daily_loss_cap': return 'daily loss cap';
    default: return step.rule;
  }
}

// The short "why" of a candidate, "LONG NIFTY 1(S1/R1) S-Stable R-Stable · EOS 24,010 #1 · SL 23,900 · T 24,200 · risk 112 · COA2 #4". Built only from the rule
// trace and the engine state at the time: the same candidate always gives the same line, so it can be stored with the decision and compared in replay.
export function reasonText(c: Candidate, a: UsableAnalysis): string {
  const head = `${c.direction.toUpperCase()} ${NAMES[a.underlying] ?? a.underlying} ${signalTag(a)}`;
  const level = `${c.level.label} ${fmt(c.level.value)} #${c.hit}`;
  if (!c.taken) return `SKIPPED ${head} · ${why(c.trace[c.trace.length - 1])} · ${level}`;
  const parts = [head, level, `SL ${fmt(c.stop!)}`, `T ${fmt(c.target!)}`, `risk ${fmt(c.plannedRiskPts!)}`];
  if (a.coa2.result.status === 'ok') parts.push(`COA2 #${a.coa2.result.number}`);
  if (a.soc) parts.push(`SOC ${a.soc.type} ${a.soc.bias}`);
  return parts.join(' · ');
}
