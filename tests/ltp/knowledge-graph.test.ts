import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildKnowledgeGraph, GRAPH_FILE } from '@/lib/ltp/knowledge-graph';
import { loadPracticeRows } from '../support/coa-practice-tool';

const graph = buildKnowledgeGraph();
const byId = new Map(graph.nodes.map((n) => [n.id, n]));

describe('the LTP knowledge graph', () => {
  it('is the file in the repository: regenerate it with `npx tsx scripts/build-ltp-graph.ts` after changing the engine', () => {
    expect(JSON.parse(readFileSync(GRAPH_FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(graph)));
  });
  it('has unique node ids and every edge joins two nodes that exist', () => {
    expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(graph.nodes.length);
    for (const e of graph.edges) { expect(byId.has(e.from), `${e.from} -> ${e.to}`).toBe(true); expect(byId.has(e.to), `${e.from} -> ${e.to}`).toBe(true); }
  });
  it('carries every history condition of the practice tool (13 strong, 5 WTB, 5 WTT), each with its wording, event log and pressure class', () => {
    const conditions = graph.nodes.filter((n) => n.type === 'condition');
    expect(conditions).toHaveLength(23);
    expect(conditions.filter((c) => c.status === 'strong')).toHaveLength(13);
    for (const c of conditions) { expect(c.number).toBe((c.index as number) + 1); expect(c.wording).toBeTruthy(); expect((c.eventLog as string[]).length).toBeGreaterThan(0); expect(graph.edges.some((e) => e.type === 'has_pressure' && e.from === c.id)).toBe(true); }
  });
  it('gives each of the nine scenarios its support and resistance status', () => {
    const scenarios = graph.nodes.filter((n) => n.type === 'scenario');
    expect(scenarios.map((s) => s.id)).toEqual(Array.from({ length: 9 }, (_, i) => `scenario:${i + 1}`));
    expect(byId.get('scenario:6')).toMatchObject({ support: 'wtb', resistance: 'wtb' });
    expect(byId.get('scenario:8')).toMatchObject({ support: 'wtb', resistance: 'wtt' });
  });
  it('has an outcome for each of the 25 pressure pairs, equal to what the practice tool shows', () => {
    const pairs = graph.nodes.filter((n) => n.type === 'pair');
    expect(pairs).toHaveLength(25);
    expect(byId.get('pair:S|S')).toMatchObject({ top: 'EOR', bottom: 'EOS', tradable: true });
    expect(byId.get('pair:HB|HU')).toMatchObject({ tradable: false, rare: true, riskyTop: 'EOR+1', riskyBottom: 'EOS-1' });
    expect(byId.get('pair:S|HB')).toMatchObject({ top: 'EOR', bottom: null });
    // The tool, box 1.1, support strong since morning against resistance shifted twice up: no top.
    const tool = loadPracticeRows().find((r) => r.box === 1 && r.supportIndex === 0 && r.resistanceIndex === 6)!;
    expect(tool.top).toBeNull();
    expect(byId.get('pair:S|HU')).toMatchObject({ top: null, bottom: 'EOS' });
  });
  it('records the owner rule on risky trades with its source, and the questions still open', () => {
    expect(byId.get('rule:risky-high-pressure')).toMatchObject({ type: 'rule', source: 'user', status: 'confirmed' });
    expect(graph.nodes.filter((n) => n.type === 'open_question').length).toBeGreaterThan(0);
    expect(graph.nodes.every((n) => n.type !== 'rule' || ['course', 'tool', 'user', 'ours'].includes(n.source as string))).toBe(true);
  });
});
