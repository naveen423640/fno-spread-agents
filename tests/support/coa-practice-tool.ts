// The Detailed Chart of Accuracy practice tool (docs/data/ltp-coa-practice-tool.json), turned into inputs for our engine: each history condition
// the tool offers becomes a synthetic event log of one side, in the words sideEvents() writes, plus the status the side has now.
import { readFileSync } from 'node:fs';

import type { Status } from '@/lib/ltp/types';

export { eventsOf, HISTORIES } from '@/lib/ltp/coa-histories';

export type PracticeRow = { box: number; heading: string; support: Status; resistance: Status; supportIndex: number; resistanceIndex: number; supportCondition: string; resistanceCondition: string; top: string | null; bottom: string | null; explanation: string; rare: boolean };
type File = { explanations: string[]; boxes: { heading: string; support: Status; resistance: Status; supportConditions: string[]; resistanceConditions: string[]; rows: string[] }[] };

export function loadPracticeRows(): PracticeRow[] {
  const file = JSON.parse(readFileSync('docs/data/ltp-coa-practice-tool.json', 'utf8')) as File;
  const out: PracticeRow[] = [];
  file.boxes.forEach((box, b) => {
    box.rows.forEach((row, n) => {
      const [top, bottom, e] = row.split('|').reduce<string[]>((acc, part, i, all) => (i < 2 ? [...acc, part] : i === 2 ? [...acc, all.slice(2).join('|')] : acc), []);
      const explanation = file.explanations[Number(e)];
      const i = Math.floor(n / box.resistanceConditions.length);
      const j = n % box.resistanceConditions.length;
      out.push({
        box: b + 1, heading: box.heading, support: box.support, resistance: box.resistance, supportIndex: i, resistanceIndex: j,
        supportCondition: box.supportConditions[i], resistanceCondition: box.resistanceConditions[j],
        top: top === 'BULL RUN' ? null : top, bottom: bottom === 'BLOOD BATH' ? null : bottom, explanation, rare: /^RARE SCENARIO/.test(explanation),
      });
    });
  });
  return out;
}
