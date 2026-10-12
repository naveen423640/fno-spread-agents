// The LTP knowledge graph: the scenarios, side histories, pressure classes, levels, trades and rules as nodes and edges, so an agent (or a person with a
// graph viewer) can follow "this history gives this pressure, this pair of pressures gives this top and bottom, this rule allows this trade". The facts
// about pressure and levels are computed by the same engine the practice-tool test checks (529 cases), so the graph cannot disagree with it.
// Written to docs/data/ltp-knowledge-graph.json by scripts/build-ltp-graph.ts; a test fails when the file is out of date.
import { COA1_TABLE } from './coa1';
import { selectDetailed } from './coa1-detailed';
import { eventsOf, HISTORY_CONDITIONS } from './coa-histories';
import { pressureOf, type Pressure } from './pressure';
import type { Status } from './types';

export const GRAPH_FILE = 'docs/data/ltp-knowledge-graph.json';
export type GraphNode = { id: string; type: string; label: string; [key: string]: unknown };
export type GraphEdge = { from: string; to: string; type: string; [key: string]: unknown };
export type KnowledgeGraph = { meta: Record<string, unknown>; nodes: GraphNode[]; edges: GraphEdge[] };

const PRESSURES: { id: Pressure; label: string; meaning: string }[] = [
  { id: 'S', label: 'Stable strong', meaning: 'No pressure: the level has been strong since the morning.' },
  { id: 'B', label: 'Bearish pressure', meaning: 'The side points down (shifted top to bottom, weak toward bottom, or a weak-toward-top that turned strong).' },
  { id: 'U', label: 'Bullish pressure', meaning: 'The side points up (shifted bottom to top, weak toward top, or a weak-toward-bottom that turned strong).' },
  { id: 'HB', label: 'Highly bearish pressure', meaning: 'Bearish twice over: double shifting down, or weak toward bottom again after a shift down. Blood Bath unless the other side is bullish.' },
  { id: 'HU', label: 'Highly bullish pressure', meaning: 'Bullish twice over: double shifting up, or weak toward top again after a shift up. Bull Run unless the other side is bearish.' },
];
const STATUSES: Record<Status, string> = { strong: 'Strong: no yellow box above 75%', wtt: 'Weak towards top: second-highest above the level, over 75%', wtb: 'Weak towards bottom: second-highest below the level, over 75%' };
const LEVELS = [
  { id: 'EOR', end: 'top', meaning: 'Extension of resistance: the usual top.' },
  { id: 'EOR+1', end: 'top', meaning: 'One strike beyond EOR: the top when the resistance carries bullish pressure.' },
  { id: 'WTT-1', end: 'top', meaning: 'One strike below the weak strike of a resistance that is weak toward top now and bullish; its WTT percentage is the key player.' },
  { id: 'EOS', end: 'bottom', meaning: 'Extension of support: the usual bottom.' },
  { id: 'EOS-1', end: 'bottom', meaning: 'One strike beyond EOS: the bottom when the support carries bearish pressure.' },
  { id: 'WTB+1', end: 'bottom', meaning: 'One strike above the weak strike of a support that is weak toward bottom now and bearish; its WTB percentage is the key player.' },
] as const;

export function buildKnowledgeGraph(): KnowledgeGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const node = (n: GraphNode) => { nodes.push(n); };
  const edge = (from: string, to: string, type: string, extra: Record<string, unknown> = {}) => { edges.push({ from, to, type, ...extra }); };

  node({ id: 'side:support', type: 'side', label: 'Support (put side)', meaning: 'Expected to hold the market from below; its bottom is EOS or a variant.' });
  node({ id: 'side:resistance', type: 'side', label: 'Resistance (call side)', meaning: 'Expected to cap the market from above; its top is EOR or a variant.' });
  for (const [id, meaning] of Object.entries(STATUSES)) node({ id: `status:${id}`, type: 'status', label: id === 'strong' ? 'Strong' : id.toUpperCase(), meaning });
  for (const p of PRESSURES) node({ id: `pressure:${p.id}`, type: 'pressure', label: p.label, code: p.id, meaning: p.meaning });
  for (const l of LEVELS) node({ id: `level:${l.id}`, type: 'level', label: l.id, end: l.end, meaning: l.meaning });
  node({ id: 'outcome:blood_bath', type: 'outcome', label: 'Blood Bath: no bottom', meaning: 'Highly bearish pressure: only the top (EOR) is available, so no long from a bottom.' });
  node({ id: 'outcome:bull_run', type: 'outcome', label: 'Bull Run: no top', meaning: 'Highly bullish pressure: only the bottom (EOS) is available, so no short from a top.' });
  node({ id: 'outcome:rare', type: 'outcome', label: 'Rare scenario: do not trade', meaning: 'Highly bearish against highly bullish: very volatile. The tool still names risky levels EOR+1 (WTT-1) and EOS-1 (WTB+1).' });

  // The nine scenarios: the current status of the two sides.
  for (const [key, s] of Object.entries(COA1_TABLE)) {
    const [support, resistance] = key.split('|') as [Status, Status];
    node({ id: `scenario:${s.number}`, type: 'scenario', label: `Scenario ${s.number}: support ${support}, resistance ${resistance}`, number: s.number, support, resistance, bias: s.bias });
    edge(`scenario:${s.number}`, `status:${support}`, 'support_is');
    edge(`scenario:${s.number}`, `status:${resistance}`, 'resistance_is');
  }

  // The 23 history conditions of the practice tool, each with its event log and the pressure it gives.
  for (const status of ['strong', 'wtb', 'wtt'] as Status[]) {
    HISTORY_CONDITIONS[status].forEach((c, i) => {
      const id = `condition:${status}:${i}`;
      const pressure = pressureOf(eventsOf(c.log), status);
      node({ id, type: 'condition', label: c.wording, status, index: i, number: i + 1, wording: c.wording, eventLog: c.log, pressure });
      edge(id, `status:${status}`, 'applies_when_status');
      edge(id, `pressure:${pressure}`, 'has_pressure');
    });
  }

  // The 25 pairs of pressures and what each gives: top, bottom, and the weak-side variants.
  const classes = PRESSURES.map((p) => p.id);
  for (const support of classes) for (const resistance of classes) {
    const plain = selectDetailed(support, resistance, 'strong', 'strong');
    const weakTop = selectDetailed(support, resistance, 'strong', 'wtt');
    const weakBottom = selectDetailed(support, resistance, 'wtb', 'strong');
    const id = `pair:${support}|${resistance}`;
    const rare = plain.risky !== undefined;
    node({
      id, type: 'pair', label: `Support ${support}, resistance ${resistance}`, support, resistance, top: plain.top, bottom: plain.bottom, tradable: plain.tradable, rare,
      topWhenResistanceWeakTowardTop: weakTop.top !== plain.top ? weakTop.top : null, bottomWhenSupportWeakTowardBottom: weakBottom.bottom !== plain.bottom ? weakBottom.bottom : null,
      ...(rare ? { riskyTop: plain.risky?.top, riskyBottom: plain.risky?.bottom } : {}),
    });
    edge(id, `pressure:${support}`, 'support_pressure');
    edge(id, `pressure:${resistance}`, 'resistance_pressure');
    if (plain.top) edge(id, `level:${plain.top}`, 'top_is'); else if (!rare) edge(id, 'outcome:bull_run', 'leads_to');
    if (plain.bottom) edge(id, `level:${plain.bottom}`, 'bottom_is'); else if (!rare) edge(id, 'outcome:blood_bath', 'leads_to');
    if (rare) edge(id, 'outcome:rare', 'leads_to');
  }

  // Trades and rules, each with where it comes from.
  node({ id: 'trade:short_at_top', type: 'trade', label: 'Short at the top (resistance side)', direction: 'short' });
  node({ id: 'trade:long_at_bottom', type: 'trade', label: 'Long at the bottom (support side)', direction: 'long' });
  node({ id: 'trade:risky_short', type: 'trade', label: 'Risky short at the tool\'s Risky level (resistance side)', direction: 'short', tier: 'risky' });
  node({ id: 'trade:risky_long', type: 'trade', label: 'Risky long at the tool\'s Risky level (support side)', direction: 'long', tier: 'risky' });
  const rule = (id: string, label: string, source: 'course' | 'tool' | 'user' | 'ours', status: 'confirmed' | 'open', detail: string) => node({ id: `rule:${id}`, type: 'rule', label, source, status, detail });
  rule('top-bottom-from-pairs', 'The top and bottom come from the pressure of both sides', 'course', 'confirmed', 'Detailed Chart of Accuracy 1.0, all 529 practice-tool cases verified (docs/ltp-coa-verification.md).');
  rule('wtt1-wtb1-substitution', 'WTT-1 / WTB+1 replace the top / bottom only for a weak side with matching pressure', 'course', 'confirmed', 'Resistance weak toward top now AND bullish gives WTT-1; support weak toward bottom now AND bearish gives WTB+1; a weak side with the other pressure keeps the plain level.');
  rule('rare-do-not-trade', 'Highly bearish against highly bullish: do not trade', 'course', 'confirmed', 'The tool still names EOR+1 (WTT-1) as the risky top and EOS-1 (WTB+1) as the risky bottom.');
  rule('first-hit-safe', 'The first touch of a level is generally safe; risk rises with each further touch', 'course', 'confirmed', 'From the chart of accuracy chapter.');
  rule('weekly-range-bands', 'Weekly range: risky, moderate and generally safe bands', 'course', 'confirmed', 'L1 risky, L2 moderate, L3 generally safe (price plus or minus S, 2S, 3S).');
  rule('risky-high-pressure', 'High pressure allows risky trades: a risky short in Blood Bath, a risky long in Bull Run', 'user', 'confirmed', 'Only for highly bearish / highly bullish pressure, not plain bearish on both sides. Direction: short when there is no bottom, long when there is no top. The level is the one the live tool shows as Risky.');
  rule('tool-lines-define-tiers', 'The live tool shows the risky and moderate levels itself', 'user', 'confirmed', 'Use the tool\'s displayed Risky and Moderate values, not our own formula (ours, EOR-1 / EOS+1, was a guess).');
  edge('rule:risky-high-pressure', 'outcome:blood_bath', 'applies_to'); edge('rule:risky-high-pressure', 'outcome:bull_run', 'applies_to');
  edge('rule:risky-high-pressure', 'trade:risky_short', 'allows', { when: 'no bottom with at least one side highly bearish' });
  edge('rule:risky-high-pressure', 'trade:risky_long', 'allows', { when: 'no top with at least one side highly bullish' });
  edge('rule:rare-do-not-trade', 'outcome:rare', 'applies_to');
  edge('rule:first-hit-safe', 'trade:short_at_top', 'applies_to'); edge('rule:first-hit-safe', 'trade:long_at_bottom', 'applies_to');
  edge('rule:wtt1-wtb1-substitution', 'level:WTT-1', 'applies_to'); edge('rule:wtt1-wtb1-substitution', 'level:WTB+1', 'applies_to');
  edge('trade:short_at_top', 'side:resistance', 'taken_on'); edge('trade:risky_short', 'side:resistance', 'taken_on');
  edge('trade:long_at_bottom', 'side:support', 'taken_on'); edge('trade:risky_long', 'side:support', 'taken_on');

  const question = (id: string, label: string) => node({ id: `open:${id}`, type: 'open_question', label });
  question('safe-moderate-risky', 'Which of the tool\'s lines is the safe, the moderate and the risky entry in each scenario?');
  question('tool-lines-definition', 'What exactly are the tool\'s Risky, Moderate, Max Pain and Max Gain lines? To be read from the live tool in a session.');
  question('one-highly-one-plain', 'One side highly bearish and the other plainly bearish also shows no bottom: does the risky rule apply? (assumed yes)');
  question('stops-targets-times', 'Stops, targets and time limits per tier.');

  return {
    meta: { name: 'LTP scenarios knowledge graph', sources: ['docs/ltp-coa-verification.md', 'docs/ltp-trade-knowledge.md', 'docs/ltp-rules-reference.md'], note: 'Generated by scripts/build-ltp-graph.ts from the engine; do not edit by hand. Node types: side, status, pressure, condition, scenario, pair, level, outcome, trade, rule (source: course, tool, user or ours), open_question.' },
    nodes, edges,
  };
}
