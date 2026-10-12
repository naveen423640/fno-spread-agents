// The history conditions of the Detailed Chart of Accuracy practice tool (https://howtouseltpcalculator.in/chart-of-accuracy-practice-tool/): the tool's
// wording, and the event log of one side that each one stands for, in the words sideEvents() writes. The translation was checked with the owner
// condition by condition on 2026-10-13 (docs/ltp-coa-verification.md, section 4).
import type { SideEvent } from './direction';
import type { Status } from './types';

export type Kind = 'init' | 'up' | 'down' | 'wtt' | 'wtb' | 'fromWtt' | 'fromWtb';
const TEXT: Record<Kind, string> = {
  init: 'STABLE STRONG', up: 'Shifted from Bottom to Top', down: 'Shifted from Top to Bottom',
  wtt: 'WEAK TOWARDS TOP', wtb: 'WEAK TOWARDS BOTTOM', fromWtt: 'WTT TO STRONG', fromWtb: 'WTB TO STRONG',
};
// Events 30 minutes apart, so no phase is short enough to be taken for noise.
export const eventsOf = (kinds: Kind[]): SideEvent[] => kinds.map((k, i) => ({ ts: i * 1800, strike: 0, status: 'strong', second: null, label: '', text: TEXT[k], direction: 'neutral' }));

export type Condition = { wording: string; log: Kind[] };
export const HISTORY_CONDITIONS: Record<Status, Condition[]> = {
  strong: [
    { wording: 'STRONG SINCE MORNING', log: ['init'] },
    { wording: 'STRONG BUT SHIFTED FROM TOP TO BOTTOM (SINGLE SHIFTING)', log: ['init', 'down'] },
    { wording: 'STRONG BUT SHIFTED FROM BOTTOM TO TOP (SINGLE SHIFTING)', log: ['init', 'up'] },
    { wording: 'INITIALLY WTB THEN BECAME STRONG', log: ['wtb', 'fromWtb'] },
    { wording: 'INITIALLY WTT THEN BECAME STRONG', log: ['wtt', 'fromWtt'] },
    { wording: 'SHIFTED FROM TOP TO BOTTOM AND AGAIN SHIFTED TO BOTTOM AND NOW STRONG (DOUBLE SHIFTING)', log: ['init', 'down', 'wtt', 'fromWtt', 'down'] },
    { wording: 'SHIFTED FROM BOTTOM TO TOP AND AGAIN SHIFTED TO TOP AND NOW STRONG (DOUBLE SHIFTING)', log: ['init', 'up', 'wtb', 'fromWtb', 'up'] },
    { wording: 'SHIFTED FROM TOP TO BOTTOM BECAME STRONG, THEN AGAIN SHIFTED FROM BOTTOM TO TOP AT ANY PLACE AND NOW STRONG', log: ['init', 'down', 'wtb', 'wtt', 'fromWtt', 'up', 'wtt', 'wtb', 'fromWtb'] },
    { wording: 'SHIFTED FROM TOP TO BOTTOM [WTT % IS THERE IN CONTINUATION] AND THEN BECAME WTT AT NEW PLACE AND ALSO SHIFTED THERE AND NOW STRONG', log: ['init', 'down', 'wtt', 'wtt', 'up'] },
    { wording: 'SHIFTED FROM TOP TO BOTTOM [WTT % IS THERE IN CONTINUATION] AND THEN BECAME WTT AT NEW PLACE AND THEN BECAME STRONG (NOT SHIFTED)', log: ['init', 'down', 'wtt', 'wtt', 'fromWtt'] },
    { wording: 'SHIFTED FROM BOTTOM TO TOP BECAME STRONG, THEN AGAIN SHIFTED FROM TOP TO BOTTOM AT ANY PLACE AND NOW STRONG', log: ['init', 'up', 'wtt', 'wtb', 'fromWtb', 'down', 'wtb', 'wtt', 'fromWtt'] },
    { wording: 'SHIFTED FROM BOTTOM TO TOP [WTB % IS THERE IN CONTINUATION] AND THEN BECAME WTB AT NEW PLACE AND ALSO SHIFTED THERE AND NOW STRONG', log: ['init', 'up', 'wtb', 'wtb', 'down'] },
    { wording: 'SHIFTED FROM BOTTOM TO TOP [WTB % IS THERE IN CONTINUATION] AND THEN BECAME WTB AT NEW PLACE AND THEN BECAME STRONG (NOT SHIFTED)', log: ['init', 'up', 'wtb', 'wtb', 'fromWtb'] },
  ],
  wtb: [
    { wording: 'WEAK TOWARDS BOTTOM', log: ['wtb'] },
    { wording: 'SHIFTED FROM TOP TO BOTTOM AND NOW AGAIN WTB', log: ['wtb', 'down', 'wtb'] },
    { wording: 'SHIFTED FROM BOTTOM TO TOP AND IN THAT CONTINUATION, IT IS LOOKING WTB', log: ['init', 'up', 'wtb'] },
    { wording: 'SHIFTED FROM BOTTOM TO TOP BECAME STRONG AND AGAIN BECAME WTB AT ANY PLACE', log: ['wtt', 'up', 'wtb', 'fromWtb', 'wtb'] },
    { wording: 'SHIFTED FROM BOTTOM TO TOP [WTB % IS THERE IN CONTINUATION] AND THEN WTB AT NEW PLACE', log: ['init', 'up', 'wtb', 'wtb'] },
  ],
  wtt: [
    { wording: 'WEAK TOWARDS TOP', log: ['wtt'] },
    { wording: 'SHIFTED FROM BOTTOM TO TOP AND NOW AGAIN WTT', log: ['wtt', 'up', 'wtt'] },
    { wording: 'SHIFTED FROM TOP TO BOTTOM AND IN THAT CONTINUATION, IT IS LOOKING WTT', log: ['init', 'down', 'wtt'] },
    { wording: 'SHIFTED FROM TOP TO BOTTOM BECAME STRONG AND AGAIN BECAME WTT AT ANY PLACE', log: ['wtb', 'down', 'wtt', 'fromWtt', 'wtt'] },
    { wording: 'SHIFTED FROM TOP TO BOTTOM [WTT % IS THERE IN CONTINUATION] AND THEN WTT AT NEW PLACE', log: ['init', 'down', 'wtt', 'wtt'] },
  ],
};
export const HISTORIES: Record<Status, Kind[][]> = {
  strong: HISTORY_CONDITIONS.strong.map((c) => c.log), wtb: HISTORY_CONDITIONS.wtb.map((c) => c.log), wtt: HISTORY_CONDITIONS.wtt.map((c) => c.log),
};
