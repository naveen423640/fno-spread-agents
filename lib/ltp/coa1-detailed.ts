// The Detailed Chart of Accuracy 1.0 (docs/ltp-rules-reference.md, part 7.2): the expected top and bottom from the pressure class of each side.
// A label is an Extensions level ('EOR', 'EOR+1', 'EOS', 'EOS-1', 'WTT-1', 'WTB+1'); null means there is no such trade (Blood Bath has no bottom, Bull Run no top).
import { COA1_TABLE, type Coa1Scenario } from './coa1';
import type { Pressure } from './pressure';
import type { Status } from './types';

export type { Pressure } from './pressure';

type Pair = [top: string | null, bottom: string | null];
const CHART: Record<`${Pressure}|${Pressure}`, Pair | undefined> = {
  'S|S': ['EOR', 'EOS'], 'S|B': ['EOR', 'EOS-1'], 'S|U': ['EOR+1', 'EOS'], 'S|HB': ['EOR', null], 'S|HU': [null, 'EOS'],
  'B|S': ['EOR', 'EOS-1'], 'B|B': ['EOR', null], 'B|U': ['EOR+1', 'EOS-1'], 'B|HU': ['EOR+1', 'EOS'], 'B|HB': undefined,
  'U|S': ['EOR+1', 'EOS'], 'U|B': ['EOR+1', 'EOS-1'], 'U|U': [null, 'EOS'], 'U|HB': ['EOR', 'EOS-1'], 'U|HU': undefined,
  'HB|S': ['EOR', null], 'HB|B': undefined, 'HB|U': ['EOR', 'EOS-1'], 'HB|HB': ['EOR', null], 'HB|HU': [null, null],
  'HU|S': [null, 'EOS'], 'HU|B': ['EOR+1', 'EOS'], 'HU|U': undefined, 'HU|HU': [null, 'EOS'], 'HU|HB': [null, null],
};
const plain = (p: Pressure): Pressure => (p === 'HB' ? 'B' : p === 'HU' ? 'U' : p);
const asStatus = (p: Pressure): Status => (p === 'B' || p === 'HB' ? 'wtb' : p === 'U' || p === 'HU' ? 'wtt' : 'strong');

// `supportNow` / `resistanceNow` are the sides' statuses at this moment: a side that is weak right now uses WTB+1 (support) or WTT-1 (resistance)
// in place of the plain bottom or top. The number and bias are the basic chart's, read from the plain pressure of each side.
export function selectDetailed(support: Pressure, resistance: Pressure, supportNow: Status, resistanceNow: Status): Coa1Scenario {
  const rare = (support === 'HB' && resistance === 'HU') || (support === 'HU' && resistance === 'HB');
  const [chartTop, chartBottom] = CHART[`${support}|${resistance}`] ?? CHART[`${plain(support)}|${plain(resistance)}`]!;
  const basic = COA1_TABLE[`${asStatus(plain(support))}|${asStatus(plain(resistance))}`];
  const top = chartTop !== null && resistanceNow === 'wtt' ? 'WTT-1' : chartTop;
  const bottom = chartBottom !== null && supportNow === 'wtb' ? 'WTB+1' : chartBottom;
  const allowed = [top ? `short at ${top}` : 'no shorts', bottom ? `long at ${bottom}` : 'no longs'];
  return { number: basic.number, bias: basic.bias, top, bottom, allowed: rare ? ['rare scenario: do not trade'] : allowed, tradable: !rare && (top !== null || bottom !== null) };
}
