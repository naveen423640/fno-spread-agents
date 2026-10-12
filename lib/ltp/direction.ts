// What the LTP Calculator calls a side's "direction". Inferred from its own support and resistance logs (NIFTY, 2026-10-12), not published:
//   weak towards top (WTT) = bullish, weak towards bottom (WTB) = bearish, "WTT TO STRONG" = bearish, "WTB TO STRONG" = bullish,
//   a level that shifts up ("Bottom to Top") = bullish, down ("Top to Bottom") = bearish, a first strong reading = neutral.
// A side's current direction is the direction of its latest event, and the banner is the two sides taken together:
// both bearish is "Blood Bath", both bullish is "Bull Run". Pure.
import type { Status } from './types';

export type Direction = 'bullish' | 'bearish' | 'neutral';
export type SideState = { ts: number; strike: number; status: Status; second: number | null }; // `second` is the weak strike, null when Strong
export type SideEvent = { ts: number; strike: number; status: Status; second: number | null; label: string; text: string; direction: Direction };

const NAME: Record<Status, string> = { strong: 'STRONG', wtt: 'WTT', wtb: 'WTB' };
const labelOf = (s: SideState) => (s.status === 'strong' || s.second === null ? `${s.strike} - ${NAME[s.status]}` : `${s.strike} - ${NAME[s.status]} - ${s.second}`);
const weakText = (status: Status) => (status === 'wtt' ? 'WEAK TOWARDS TOP' : 'WEAK TOWARDS BOTTOM');
const weakDirection = (status: Status): Direction => (status === 'wtt' ? 'bullish' : 'bearish');

// One event each time the level moves, the status changes, or the weak strike changes. Unchanged minutes add nothing.
export function sideEvents(states: SideState[]): SideEvent[] {
  const out: SideEvent[] = [];
  let prev: SideState | undefined;
  for (const s of states) {
    let text: string | null = null;
    let direction: Direction = 'neutral';
    if (!prev) {
      if (s.status === 'strong') text = 'STABLE STRONG';
      else { text = weakText(s.status); direction = weakDirection(s.status); }
    } else if (s.strike !== prev.strike) {
      const up = s.strike > prev.strike;
      text = up ? 'Shifted from Bottom to Top' : 'Shifted from Top to Bottom';
      direction = up ? 'bullish' : 'bearish';
    } else if (s.status !== prev.status) {
      if (s.status === 'strong') { text = `${NAME[prev.status]} TO STRONG`; direction = prev.status === 'wtt' ? 'bearish' : 'bullish'; }
      else { text = weakText(s.status); direction = weakDirection(s.status); }
    } else if (s.status !== 'strong' && s.second !== prev.second) {
      text = weakText(s.status); direction = weakDirection(s.status);
    }
    if (text !== null) out.push({ ts: s.ts, strike: s.strike, status: s.status, second: s.second, label: labelOf(s), text, direction });
    prev = s;
  }
  return out;
}

export const currentDirection = (events: SideEvent[]): Direction => events[events.length - 1]?.direction ?? 'neutral';

export type Banner = { kind: 'blood_bath' | 'bull_run' | 'mixed'; text: string };
export function banner(support: Direction, resistance: Direction): Banner {
  if (support === 'bearish' && resistance === 'bearish') return { kind: 'blood_bath', text: 'Blood Bath' };
  if (support === 'bullish' && resistance === 'bullish') return { kind: 'bull_run', text: 'Bull Run' };
  return { kind: 'mixed', text: 'Mixed' };
}
