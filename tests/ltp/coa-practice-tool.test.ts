import { describe, expect, it } from 'vitest';

import { selectDetailed } from '@/lib/ltp/coa1-detailed';
import { pressureOf } from '@/lib/ltp/pressure';
import { eventsOf, HISTORIES, loadPracticeRows } from '../support/coa-practice-tool';

// Every case of the practice tool at https://howtouseltpcalculator.in/chart-of-accuracy-practice-tool/ run through our engine: each side's history
// becomes an event log, pressureOf() gives its class and selectDetailed() the top and bottom, and the result is compared with what the tool shows.
const rows = loadPracticeRows();
const ours = (r: (typeof rows)[number]) => {
  const sup = pressureOf(eventsOf(HISTORIES[r.support][r.supportIndex]), r.support);
  const res = pressureOf(eventsOf(HISTORIES[r.resistance][r.resistanceIndex]), r.resistance);
  return { sup, res, scenario: selectDetailed(sup, res, r.support, r.resistance) };
};

describe('the practice tool, all cases', () => {
  it('in the rare scenario (highly bearish against highly bullish) the tool says do not trade, and names a risky top and bottom for anyone who still does', () => {
    const rare = rows.filter((r) => r.rare);
    expect(rare).toHaveLength(8);
    for (const r of rare) {
      const o = ours(r).scenario;
      expect(o.tradable, `${r.heading} S[${r.supportIndex}] R[${r.resistanceIndex}]`).toBe(false);
      expect(o.risky, `${r.heading} S[${r.supportIndex}] R[${r.resistanceIndex}]`).toEqual({ top: r.top, bottom: r.bottom });
    }
  });
  it('has the 529 cases in 9 boxes', () => { expect(rows).toHaveLength(529); });
  it('our top and bottom equal the tool\'s in every case that is not the rare scenario', () => {
    const wrong = rows.filter((r) => !r.rare).filter((r) => { const o = ours(r).scenario; return o.top !== r.top || o.bottom !== r.bottom; });
    console.log(`mismatches ${wrong.length} of ${rows.filter((r) => !r.rare).length}`);
    console.log(wrong.slice(0, 40).map((r) => `${r.heading} S[${r.supportIndex}] R[${r.resistanceIndex}] tool ${r.top}/${r.bottom} ours ${ours(r).scenario.top}/${ours(r).scenario.bottom} (${ours(r).sup}|${ours(r).res})`).join('\n'));
    expect(wrong).toHaveLength(0);
  });
});
