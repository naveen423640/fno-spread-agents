// How the agent uses the LTP knowledge graph (lib/ltp/knowledge-graph.ts, docs/data/ltp-knowledge-graph.json):
//  - graphTrace: for each decision, which pressure pair, top, bottom and rules the situation rests on, and whether the live scenario agrees with the
//    graph. Recorded in the decision's context, so a trade can be explained and checked against the rules afterwards.
//  - rulebookText: the graph as plain text for the model that reviews trades and proposes experiments. That model never decides a trade.
// The rule engine itself is not changed by this: it computes the same facts the graph is generated from.
import type { UsableAnalysis } from '@/lib/ltp/analyze';
import { buildKnowledgeGraph, type KnowledgeGraph } from '@/lib/ltp/knowledge-graph';

let cached: KnowledgeGraph | null = null;
const graph = () => (cached ??= buildKnowledgeGraph());

export type GraphTrace = {
  pair: string; supportPressure: string; resistancePressure: string; top: string | null; bottom: string | null;
  outcome: 'blood_bath' | 'bull_run' | 'rare' | null; consistent: boolean; rules: string[]; ownerRuleNotUsedForTrading?: true;
};

export function graphTrace(a: UsableAnalysis): GraphTrace {
  const g = graph();
  const { support, resistance } = a.coa1.pressure;
  const id = `pair:${support}|${resistance}`;
  const pair = g.nodes.find((n) => n.id === id)!;
  const outcomeEdge = g.edges.find((e) => e.from === id && e.type === 'leads_to');
  const outcome = outcomeEdge ? (outcomeEdge.to.replace('outcome:', '') as GraphTrace['outcome']) : null;
  const rare = pair.rare === true;
  // What the graph gives for the sides' current statuses: the plain level, or the WTT-1 / WTB+1 variant for a weak side with matching pressure.
  const top = rare ? null : ((a.strength.resistance.status === 'wtt' ? (pair.topWhenResistanceWeakTowardTop as string | null) : null) ?? (pair.top as string | null));
  const bottom = rare ? null : ((a.strength.support.status === 'wtb' ? (pair.bottomWhenSupportWeakTowardBottom as string | null) : null) ?? (pair.bottom as string | null));
  const rules = ['top-bottom-from-pairs'];
  if (top === 'WTT-1' || bottom === 'WTB+1') rules.push('wtt1-wtb1-substitution');
  if (rare) rules.push('rare-do-not-trade');
  const highlyBearish = support === 'HB' || resistance === 'HB';
  const highlyBullish = support === 'HU' || resistance === 'HU';
  const riskyRule = (outcome === 'blood_bath' && highlyBearish) || (outcome === 'bull_run' && highlyBullish);
  if (riskyRule) rules.push('risky-high-pressure');
  return {
    pair: `${support}|${resistance}`, supportPressure: support, resistancePressure: resistance, top, bottom, outcome,
    consistent: a.coa1.scenario.top === top && a.coa1.scenario.bottom === bottom, rules,
    // The owner's risky-trade rule is recorded for the reviewer, but the agent does not trade on it until the tool's Risky level is defined.
    ...(riskyRule ? { ownerRuleNotUsedForTrading: true as const } : {}),
  };
}

export function rulebookText(): string {
  const g = graph();
  const lines: string[] = ['RULEBOOK (the LTP knowledge graph; the rules, not you, decide trades. Use only what is written here.)'];
  lines.push('Pressure of a side, from its history today:');
  for (const n of g.nodes.filter((x) => x.type === 'pressure')) lines.push(`- ${n.code} ${n.label}: ${n.meaning}`);
  lines.push('Top and bottom from the pair (support|resistance):');
  const groups = new Map<string, string[]>();
  for (const n of g.nodes.filter((x) => x.type === 'pair')) {
    const key = n.rare ? `rare scenario, do not trade (risky ${n.riskyTop} / ${n.riskyBottom})` : `top ${n.top ?? 'none (Bull Run)'}, bottom ${n.bottom ?? 'none (Blood Bath)'}`;
    groups.set(key, [...(groups.get(key) ?? []), `${n.support}|${n.resistance}`]);
  }
  for (const [key, pairs] of groups) lines.push(`- ${key}: ${pairs.join(' ')}`);
  lines.push('Rules (source in brackets):');
  for (const n of g.nodes.filter((x) => x.type === 'rule')) lines.push(`- [${n.source}] ${n.label}`);
  lines.push('Open questions (not decided; do not invent answers):');
  for (const n of g.nodes.filter((x) => x.type === 'open_question')) lines.push(`- ${n.label}`);
  lines.push('Do not invent tiers, levels or rules that are not in this rulebook.');
  return lines.join('\n');
}
