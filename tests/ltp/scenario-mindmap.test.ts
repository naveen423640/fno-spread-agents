import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildScenarioMindmap, SCENARIO_MINDMAP_FILE } from '@/lib/ltp/scenario-mindmap';

const map = buildScenarioMindmap();

describe('the nine-scenario mind map', () => {
  it('is the file in the repository: regenerate it with `npx tsx scripts/build-ltp-mindmaps.ts`', () => {
    expect(readFileSync(SCENARIO_MINDMAP_FILE, 'utf8')).toBe(map);
  });
  it('has one root and a branch for each of the nine boxes, in the practice tool\'s order', () => {
    expect(map.match(/^# /gm)).toHaveLength(1);
    const boxes = [...map.matchAll(/^## COA 1\.(\d): /gm)].map((m) => m[1]);
    expect(boxes).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });
  it('lists every history condition of every box with its pressure', () => {
    const supports = [...map.matchAll(/^- \*\*S\d+\*\* .* → (stable strong|bearish|bullish|highly bearish|highly bullish)$/gm)];
    const resistances = [...map.matchAll(/^- \*\*R\d+\*\* .* → (stable strong|bearish|bullish|highly bearish|highly bullish)$/gm)];
    // 13+13+13+5+5+5+5+5+5 support conditions, 13+5+5+13+13+5+5+5+5 resistance conditions across the nine boxes.
    expect(supports).toHaveLength(13 + 13 + 13 + 5 + 5 + 5 + 5 + 5 + 5);
    expect(resistances).toHaveLength(13 + 5 + 5 + 13 + 13 + 5 + 5 + 5 + 5);
  });
  it('accounts for every one of the 529 cases exactly once under an outcome', () => {
    const cases = [...map.matchAll(/^      - S\d+ with R([\d, ]+)$/gm)].reduce((n, m) => n + m[1].split(',').length, 0);
    expect(cases).toBe(529);
  });
  it('writes WTB and WTT in capitals', () => { expect(map).not.toMatch(/WT[tb]\b/); expect(map).toContain('Weak towards bottom → bearish'.replace('bottom', 'bottom')); });
  it('shows the trades each outcome allows, the owner rule where it applies, and the rare scenario as do not trade', () => {
    expect(map).toContain('Short at EOR (resistance side)');
    expect(map).toContain('No long from a bottom (Blood Bath)');
    expect(map).toContain('Risky short allowed at the tool\'s Risky level [owner rule]');
    expect(map).toContain('Rare scenario: do not trade');
  });
});
