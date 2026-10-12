// Writes docs/data/ltp-knowledge-graph.json from the engine (lib/ltp/knowledge-graph.ts). Run after changing the pressure or chart rules.
import { writeFileSync } from 'node:fs';

import { buildKnowledgeGraph, GRAPH_FILE } from '../lib/ltp/knowledge-graph';

const graph = buildKnowledgeGraph();
writeFileSync(GRAPH_FILE, `${JSON.stringify(graph, null, 1)}\n`);
console.log(`Wrote ${graph.nodes.length} nodes and ${graph.edges.length} edges to ${GRAPH_FILE}`);
