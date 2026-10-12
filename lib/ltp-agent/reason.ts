// The plain-English "why" of a candidate, built only from its rule trace and the engine state at the time. No clock, no randomness: the same
// candidate always gives the same sentence, so it can be stored with the decision and compared in replay.
import type { UsableAnalysis } from '@/lib/ltp/analyze';
import { istHhmm } from '@/lib/ltp/time';
import type { Candidate, RuleStep } from './signals';

const NAMES: Record<string, string> = { 'NSE:NIFTY50-INDEX': 'NIFTY', 'NSE:NIFTYBANK-INDEX': 'BANKNIFTY', 'BSE:SENSEX-INDEX': 'SENSEX' };
const fmt = (x: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(x);
const STATUS: Record<string, string> = { strong: 'Strong', wtt: 'WTT', wtb: 'WTB' };
const cap = (s: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : 'unknown');

function why(step: RuleStep, c: Candidate): string {
  const i = step.inputs;
  switch (step.rule) {
    case 'scenario_allowed': return `scenario ${c.scenario} does not allow ${c.direction === 'long' ? 'longs' : 'shorts'}`;
    case 'time_window': return `${i.time} is outside the ${i.start} to ${i.end} window`;
    case 'valid_plan': return 'there is no usable stop and target around this entry';
    case 'hit_number': return `hit #${i.hit} is above the maximum of ${i.max}`;
    case 'coa2_agree': return 'COA 2.0 is required to agree and does not';
    case 'soc_opposes': return `an opposing State of Confusion (${i.soc}) is active`;
    case 'daily_trade_cap': return 'the daily trade cap is reached';
    case 'max_concurrent': return 'a trade is already open on this underlying';
    case 'daily_loss_cap': return 'the daily loss cap is reached';
    default: return step.rule;
  }
}

export function reasonText(c: Candidate, a: UsableAnalysis): string {
  const dir = c.direction.toUpperCase();
  const name = NAMES[a.underlying] ?? a.underlying;
  const input = (rule: string) => c.trace.find((s) => s.rule === rule)?.inputs ?? {};
  const time = istHhmm(a.asOf);
  const scenario = `COA-1 scenario ${c.scenario} (${STATUS[a.strength.support.status]}/${STATUS[a.strength.resistance.status]}; directions ${a.direction.support.current}/${a.direction.resistance.current})`;
  const touch = `spot ${fmt(a.spot)} touched ${c.level.label} ${fmt(c.level.value)} (proxy: ${a.method.label}) on hit #${c.hit}`;
  if (!c.taken) {
    const failed = c.trace[c.trace.length - 1];
    return `SKIPPED ${dir} ${name}: ${why(failed, c)}; ${scenario}; ${touch}; ${time}.`;
  }
  const agrees = input('coa2_agree').agrees;
  const coa2 = a.coa2.result.status === 'ok'
    ? `COA-2 = ${cap(a.coa2.callTrend)}/${cap(a.coa2.putTrend)} ${agrees === true ? 'agrees' : 'disagrees (logged only)'}`
    : `COA-2 not available (${a.coa2.result.status})`;
  const soc = a.soc ? `SOC ${a.soc.type} ${a.soc.bias} does not oppose` : 'no opposing SOC';
  return `${dir} ${name}: ${scenario}; ${touch}; ${coa2}; ${soc}; ${time} inside window. SL ${fmt(c.stop!)}, target ${fmt(c.target!)}, planned risk ${fmt(c.plannedRiskPts!)} pts.`;
}
