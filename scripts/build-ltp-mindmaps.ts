// Writes docs/ltp-scenarios-by-box.mindmap.md (the nine scenarios, laid out like the practice tool). Run after changing the chart rules or the data.
import { writeFileSync } from 'node:fs';

import { buildScenarioMindmap, SCENARIO_MINDMAP_FILE } from '../lib/ltp/scenario-mindmap';

writeFileSync(SCENARIO_MINDMAP_FILE, buildScenarioMindmap());
console.log(`Wrote ${SCENARIO_MINDMAP_FILE}`);
