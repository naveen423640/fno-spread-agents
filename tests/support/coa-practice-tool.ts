// The Detailed Chart of Accuracy practice tool (docs/data/ltp-coa-practice-tool.json), turned into inputs for our engine: each history condition
// the tool offers becomes a synthetic event log of one side, in the words sideEvents() writes, plus the status the side has now.
import { readFileSync } from 'node:fs';

import type { SideEvent } from '@/lib/ltp/direction';
import type { Status } from '@/lib/ltp/types';

type Kind = 'init' | 'up' | 'down' | 'wtt' | 'wtb' | 'fromWtt' | 'fromWtb';
const TEXT: Record<Kind, string> = {
  init: 'STABLE STRONG', up: 'Shifted from Bottom to Top', down: 'Shifted from Top to Bottom',
  wtt: 'WEAK TOWARDS TOP', wtb: 'WEAK TOWARDS BOTTOM', fromWtt: 'WTT TO STRONG', fromWtb: 'WTB TO STRONG',
};
export const eventsOf = (kinds: Kind[]): SideEvent[] => kinds.map((k, i) => ({ ts: i, strike: 0, status: 'strong', second: null, label: '', text: TEXT[k], direction: 'neutral' }));

// The index of a condition in the tool's list gives the history it describes (the tool's wording is in the JSON file).
const STRONG: Kind[][] = [
  ['init'], // 0 strong since morning
  ['init', 'down'], // 1 strong but shifted top to bottom
  ['init', 'up'], // 2 strong but shifted bottom to top
  ['wtb', 'fromWtb'], // 3 initially WTB then strong
  ['wtt', 'fromWtt'], // 4 initially WTT then strong
  ['init', 'down', 'down'], // 5 double shifting down
  ['init', 'up', 'up'], // 6 double shifting up
  ['init', 'down', 'up'], // 7 shifted down, strong, then shifted up
  ['init', 'down', 'wtt', 'up'], // 8 shifted down with WTT, WTT at a new place and shifted there, now strong
  ['init', 'down', 'wtt', 'wtt', 'fromWtt'], // 9 shifted down with WTT, WTT at a new place, then strong
  ['init', 'up', 'down'], // 10 shifted up, strong, then shifted down
  ['init', 'up', 'wtb', 'down'], // 11 shifted up with WTB, WTB at a new place and shifted there, now strong
  ['init', 'up', 'wtb', 'wtb', 'fromWtb'], // 12 shifted up with WTB, WTB at a new place, then strong
];
const WTB: Kind[][] = [
  ['wtb'], // 0 weak towards bottom
  ['wtb', 'down', 'wtb'], // 1 (user-confirmed) was WTB earlier, shifted down, WTB again now
  ['init', 'up', 'wtb'], // 2 shifted up and in that continuation WTB
  ['wtt', 'up', 'wtb', 'fromWtb', 'wtb'], // 3 (user-confirmed) WTT, shifted up with WTB at the old strike, WTB gone (strong), then a new WTB
  ['init', 'up', 'wtb', 'wtb'], // 4 shifted up with WTB, then WTB at a new place
];
const WTT: Kind[][] = [
  ['wtt'], ['wtt', 'up', 'wtt'], ['init', 'down', 'wtt'], ['wtb', 'down', 'wtt', 'fromWtt', 'wtt'], ['init', 'down', 'wtt', 'wtt'],
];
export const HISTORIES: Record<Status, Kind[][]> = { strong: STRONG, wtb: WTB, wtt: WTT };

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
