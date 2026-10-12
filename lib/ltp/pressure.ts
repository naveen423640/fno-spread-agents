// The pressure class of one side, read from its history today. This is the "Detailed Chart of Accuracy 1.0" of the LTP Calculator practice tool
// (docs/ltp-rules-reference.md, part 7.1): S stable strong, B bearish, U bullish, HB highly bearish, HU highly bullish. Pure.
import type { SideEvent } from './direction';
import type { Status } from './types';

export type Pressure = 'S' | 'B' | 'U' | 'HB' | 'HU';
type Kind = 'init' | 'up' | 'down' | 'wtt' | 'wtb' | 'fromWtt' | 'fromWtb';

function kindOf(e: SideEvent): Kind {
  if (e.text.startsWith('Shifted from Bottom')) return 'up';
  if (e.text.startsWith('Shifted from Top')) return 'down';
  if (e.text === 'WTT TO STRONG') return 'fromWtt';
  if (e.text === 'WTB TO STRONG') return 'fromWtb';
  if (e.text === 'WEAK TOWARDS TOP') return 'wtt';
  if (e.text === 'WEAK TOWARDS BOTTOM') return 'wtb';
  return 'init';
}

// `now` is the side's status at this moment; `events` is its log since the open (see sideEvents).
//   Strong now: the latest event decides (a shift down or WTT-to-strong is bearish, a shift up or WTB-to-strong bullish); two shifts the same way are "highly".
//   Weak now: WTB is bearish and WTT bullish, "highly" when the level shifted that way after already being weak that way. A weakness that
//   shows up right after a shift the other way, in that shift's continuation, points the other way; if the weak strike then moves
//   again (a second weak event) it is back to the plain direction.
export function pressureOf(events: SideEvent[], now: Status): Pressure {
  const kinds = events.map(kindOf);
  const last = kinds[kinds.length - 1];
  if (!last) return 'S';
  if (now === 'strong') {
    if (last === 'fromWtb') return 'U';
    if (last === 'fromWtt') return 'B';
    if (last === 'up' || last === 'down') {
      const earlier = kinds.slice(0, -1).reverse().find((k) => k === 'up' || k === 'down');
      if (earlier === last) return last === 'up' ? 'HU' : 'HB';
      return last === 'up' ? 'U' : 'B';
    }
    return 'S';
  }
  const mine: Kind = now === 'wtb' ? 'wtb' : 'wtt';
  let i = kinds.length - 1;
  let weakEvents = 0;
  while (i >= 0 && kinds[i] === mine) { weakEvents += 1; i -= 1; }
  const before = kinds[i];
  const plain: Pressure = now === 'wtb' ? 'B' : 'U';
  const flipped: Pressure = now === 'wtb' ? 'U' : 'B';
  const highly: Pressure = now === 'wtb' ? 'HB' : 'HU';
  const shiftAgainst = now === 'wtb' ? 'up' : 'down'; // a shift that points the other way from this weakness
  const shiftWith = now === 'wtb' ? 'down' : 'up';
  if (before === shiftAgainst) return weakEvents > 1 ? plain : flipped;
  if (before === shiftWith) return kinds[i - 1] === mine ? highly : plain;
  return plain;
}
