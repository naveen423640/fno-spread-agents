// The mind map of the nine scenarios, laid out like the practice tool: scenario (COA box), then the history conditions of each side with the pressure they
// give, then every outcome the tool shows (top, bottom), the pressure pair behind it, when it happens, and the trades it allows.
// Generated from docs/data/ltp-coa-practice-tool.json and the knowledge graph; written to docs/ltp-scenarios-by-box.mindmap.md by scripts/build-ltp-mindmaps.ts.
import { readFileSync } from 'node:fs';

import { buildKnowledgeGraph } from './knowledge-graph';
import { sideTag, tugOfWar } from './tug-of-war';
import type { Pressure } from './pressure';

export const SCENARIO_MINDMAP_FILE = 'docs/ltp-scenarios-by-box.mindmap.md';
type Box = { heading: string; support: string; resistance: string; supportConditions: string[]; resistanceConditions: string[]; rows: string[] };
type Data = { explanations: string[]; boxes: Box[] };

const NAME: Record<string, string> = { strong: 'Strong', wtb: 'WTB (weak toward bottom)', wtt: 'WTT (weak toward top)' };
const WORD: Record<string, string> = { S: 'stable strong', B: 'bearish', U: 'bullish', HB: 'highly bearish', HU: 'highly bullish' };
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/\bwt([tb])\b/g, (_m, c: string) => `WT${c.toUpperCase()}`);
const range = (n: number[]) => n.map((i) => `${i + 1}`).join(', ');

function trades(top: string | null, bottom: string | null, rare: boolean): string[] {
  if (rare) return ['Do not trade: the market is very volatile', 'For anyone who still trades: risky short at the top shown, risky long at the bottom shown'];
  const out: string[] = [];
  out.push(top ? `Short at ${top} (resistance side)` : 'No short from a top (Bull Run)');
  out.push(bottom ? `Long at ${bottom} (support side)` : 'No long from a bottom (Blood Bath)');
  if (top === 'WTT-1' || bottom === 'WTB+1') out.push('WTT / WTB percentage is the key player for the weak-side level');
  return out;
}

export function buildScenarioMindmap(): string {
  const data = JSON.parse(readFileSync('docs/data/ltp-coa-practice-tool.json', 'utf8')) as Data;
  const graph = buildKnowledgeGraph();
  const pressureOf = (status: string, index: number) => graph.nodes.find((n) => n.id === `condition:${status}:${index}`)!.pressure as string;
  const out: string[] = [];
  const w = (s = '') => out.push(s);
  w('---\ntitle: The 9 scenarios of the Detailed Chart of Accuracy\nmarkmap:\n  colorFreezeLevel: 2\n  maxWidth: 420\n---\n');
  w('# The 9 scenarios: history, pressure, top and bottom, trades\n');
  w('## How to read this\n- Pick the scenario (COA box) = the status of the two sides now\n- Each side has a history condition (S1, S2 ... for support; R1, R2 ... for resistance; the live label reads scenario-S/R, for example 6-S3/R1)\n- The history gives a pressure: stable strong, bearish, bullish, highly bearish, highly bullish\n- The pair of pressures gives the top and bottom, and who is winning the tug of war\n- The top and bottom decide the trades; the tug of war decides whether a risky trade is also allowed\n- Tags: S-Bearish / R-Bullish, with (H) when high\n- Source: the practice tool, 529 cases, all matched by our engine; pressure per condition is our reading, confirmed with the owner\n');
  data.boxes.forEach((box, bi) => {
    const nr = box.resistanceConditions.length;
    w(`## COA 1.${bi + 1}: support ${NAME[box.support]}, resistance ${NAME[box.resistance]}`);
    w('### Support history');
    box.supportConditions.forEach((c, i) => w(`- **S${i + 1}** ${sentence(c)} → ${WORD[pressureOf(box.support, i)]}`));
    w('### Resistance history');
    box.resistanceConditions.forEach((c, j) => w(`- **R${j + 1}** ${sentence(c)} → ${WORD[pressureOf(box.resistance, j)]}`));
    w('### Outcomes and trades');
    // Group the cases by outcome (top, bottom), then by the pressure pair behind it.
    type Group = { top: string | null; bottom: string | null; rare: boolean; pairs: Map<string, Map<number, number[]>> };
    const groups = new Map<string, Group>();
    box.rows.forEach((row, n) => {
      const [t, b, e] = row.split('|');
      const i = Math.floor(n / nr);
      const j = n % nr;
      const rare = data.explanations[Number(e)].startsWith('RARE');
      const top = t === 'BULL RUN' ? null : t;
      const bottom = b === 'BLOOD BATH' ? null : b;
      const key = `${top}|${bottom}|${rare}`;
      const group = groups.get(key) ?? { top, bottom, rare, pairs: new Map() };
      const pair = `${pressureOf(box.support, i)}|${pressureOf(box.resistance, j)}`;
      const bySupport = group.pairs.get(pair) ?? new Map<number, number[]>();
      bySupport.set(i, [...(bySupport.get(i) ?? []), j]);
      group.pairs.set(pair, bySupport);
      groups.set(key, group);
    });
    for (const g of [...groups.values()].sort((a, b) => Number(a.rare) - Number(b.rare) || [...b.pairs.values()].length - [...a.pairs.values()].length)) {
      const title = g.rare ? 'Rare scenario: do not trade' : `${g.top ? `Top ${g.top}` : 'No top (Bull Run)'}, ${g.bottom ? `bottom ${g.bottom}` : 'no bottom (Blood Bath)'}`;
      w(`- **${title}**`);
      w('  - Trades');
      for (const t of trades(g.top, g.bottom, g.rare)) w(`    - ${t}`);
      w('  - Tug of war and when it happens');
      for (const [pair, bySupport] of g.pairs) {
        const [s, r] = pair.split('|');
        const tug = tugOfWar(s as Pressure, r as Pressure);
        w(`    - ${sideTag('S', s as Pressure)} ${sideTag('R', r as Pressure)}${tug.riskyAllowed ? ` · risky ${tug.riskyDirection} OK` : ''}`);
        for (const [i, js] of bySupport) w(`      - S${i + 1} with R${range(js)}`);
      }
    }
  });
  w('## Rules behind the outcomes\n- No bottom (Blood Bath) = highly bearish pressure; no top (Bull Run) = highly bullish\n- A highly bearish side against a bullish side stops the Blood Bath, and the bottom is EOS-1\n- Highly bearish against highly bullish = rare scenario, do not trade\n- WTT-1 replaces the top, WTB+1 the bottom, only for a weak side that is bullish (resistance) or bearish (support)\n- Tug of war [owner rule]: risky trade allowed when both sides push one way, or one pushes highly and the other is stable; bears winning = risky short, bulls = risky long; level = the tool\'s Risky line\n- Do not skip on the first-level scenario: decide from this outcome\n- Safe, moderate and risky entries for the other scenarios: still open');
  return `${out.join('\n')}\n`;
}
